# How Sentiment Drives Trading (Mahoraga)

This document explains how sentiment scores are computed, how `min_sentiment_score` gates research, and how LLM
research and analyst steps translate into trades. Math is shown using MathJax, and key code paths are included.

## 1) Sentiment math (core formulas)

### 1.1 Keyword sentiment (Reddit + Twitter word scoring)

The baseline sentiment detector counts bullish and bearish keywords and normalizes the result to \([-1, 1]\):

$$
\text{score} = \frac{B - S}{B + S}, \quad \text{where } B=\text{bullish hits},\ S=\text{bearish hits}
$$

```813:860:src/durable-objects/mahoraga-harness.ts
function detectSentiment(text: string): number {
  const lower = text.toLowerCase();
  const bullish = [
    "moon",
    "rocket",
    "buy",
    "calls",
    "long",
    "bullish",
    "yolo",
    "tendies",
    "gains",
    "diamond",
    "squeeze",
    "pump",
    "green",
    "up",
    "breakout",
    "undervalued",
    "accumulate",
  ];
  const bearish = [
    "puts",
    "short",
    "sell",
    "bearish",
    "crash",
    "dump",
    "drill",
    "tank",
    "rip",
    "red",
    "down",
    "bag",
    "overvalued",
    "bubble",
    "avoid",
  ];

  let bull = 0,
    bear = 0;
  for (const w of bullish) if (lower.includes(w)) bull++;
  for (const w of bearish) if (lower.includes(w)) bear++;

  const total = bull + bear;
  if (total === 0) return 0;
  return (bull - bear) / total;
}
```

### 1.2 Time decay + engagement + flair weighting

Each post gets a quality multiplier. The decay uses a half-life:

$$
\text{decay} = 0.5^{\frac{\text{ageMinutes}}{\text{halfLife}}}, \quad \text{clamped to } [0.2, 1.0]
$$

Engagement is averaged from upvotes and comments thresholds, and flair is a lookup multiplier:

$$
\text{quality} = \text{decay} \times \text{engagement} \times \text{flair} \times \text{sourceWeight}
$$

```748:786:src/durable-objects/mahoraga-harness.ts
function calculateTimeDecay(postTimestamp: number): number {
  const ageMinutes = (Date.now() - postTimestamp * 1000) / 60000;
  const halfLife = SOURCE_CONFIG.decayHalfLifeMinutes;
  const decay = 0.5 ** (ageMinutes / halfLife);
  return Math.max(0.2, Math.min(1.0, decay));
}

function getEngagementMultiplier(upvotes: number, comments: number): number {
  let upvoteMultiplier = 0.8;
  const upvoteThresholds = Object.entries(SOURCE_CONFIG.engagement.upvotes).sort(([a], [b]) => Number(b) - Number(a));
  for (const [threshold, mult] of upvoteThresholds) {
    if (upvotes >= parseInt(threshold, 10)) {
      upvoteMultiplier = mult;
      break;
    }
  }

  let commentMultiplier = 0.9;
  const commentThresholds = Object.entries(SOURCE_CONFIG.engagement.comments).sort(([a], [b]) => Number(b) - Number(a));
  for (const [threshold, mult] of commentThresholds) {
    if (comments >= parseInt(threshold, 10)) {
      commentMultiplier = mult;
      break;
    }
  }

  return (upvoteMultiplier + commentMultiplier) / 2;
}

function getFlairMultiplier(flair: string | null | undefined): number {
  if (!flair) return 1.0;
  return SOURCE_CONFIG.flairMultipliers[flair.trim()] || 1.0;
}
```

### 1.3 Reddit aggregation

Raw sentiment is computed per post (keyword score) then combined with quality:

$$
\text{weightedSentiment} += \text{rawSentiment} \times \text{quality}
$$
$$
\text{finalSentiment} = \frac{\text{weightedSentiment}}{\text{mentions}}
$$

```1821:1903:src/durable-objects/mahoraga-harness.ts
for (const post of posts) {
  const text = `${post.title || ""} ${post.selftext || ""}`;
  const tickers = extractTickers(text, this.state.config.ticker_blacklist);
  const rawSentiment = detectSentiment(text);

  const timeDecay = calculateTimeDecay(post.created_utc || Date.now() / 1000);
  const engagementMult = getEngagementMultiplier(post.ups || 0, post.num_comments || 0);
  const flairMult = getFlairMultiplier(post.link_flair_text);
  const qualityScore = timeDecay * engagementMult * flairMult * sourceWeight;

  for (const ticker of tickers) {
    if (!tickerData.has(ticker)) {
      tickerData.set(ticker, {
        mentions: 0,
        weightedSentiment: 0,
        rawSentiment: 0,
        totalQuality: 0,
        upvotes: 0,
        comments: 0,
        sources: new Set(),
        bestFlair: null,
        bestFlairMult: 0,
        freshestPost: 0,
      });
    }
    const d = tickerData.get(ticker)!;
    d.mentions++;
    d.rawSentiment += rawSentiment;
    d.weightedSentiment += rawSentiment * qualityScore;
    d.totalQuality += qualityScore;
    d.upvotes += post.ups || 0;
    d.comments += post.num_comments || 0;
    d.sources.add(sub);
  }
}
```

### 1.4 StockTwits aggregation

StockTwits uses its own Bullish/Bearish labels and time decay:

$$
\text{score} = \frac{\text{bullish} - \text{bearish}}{\text{effectiveTotal}}
$$
$$
\text{weightedSentiment} = \text{score} \times \text{sourceWeight} \times \text{avgFreshness}
$$

```1720:1746:src/durable-objects/mahoraga-harness.ts
let bullish = 0,
  bearish = 0,
  totalTimeDecay = 0;
for (const msg of messages) {
  const sentiment = msg.entities?.sentiment?.basic;
  const msgTime = new Date(msg.created_at || Date.now()).getTime() / 1000;
  const timeDecay = calculateTimeDecay(msgTime);
  totalTimeDecay += timeDecay;

  if (sentiment === "Bullish") bullish += timeDecay;
  else if (sentiment === "Bearish") bearish += timeDecay;
}

const total = messages.length;
const effectiveTotal = totalTimeDecay || 1;
const score = effectiveTotal > 0 ? (bullish - bearish) / effectiveTotal : 0;
const avgFreshness = total > 0 ? totalTimeDecay / total : 0;

if (total >= 5) {
  const weightedSentiment = score * sourceWeight * avgFreshness;
  signals.push({ sentiment: weightedSentiment, raw_sentiment: score, ... });
}
```

### 1.5 Cross-source merge (composite score)

Signals are merged by symbol and scored:

$$
\text{composite} = |\text{sentiment}| \times \text{sourceWeight} \times \text{freshness} \times \text{sourceCountBonus}
$$

```1580:1626:src/durable-objects/mahoraga-harness.ts
const freshRaw = allSignals.filter((s) => now - s.timestamp < MAX_AGE_MS);

const bySymbol = new Map<
  string,
  { sentiment: number; raw_sentiment: number; volume: number; sources: string[]; best: Signal }
>();
for (const s of freshRaw) {
  const sym = s.symbol.toUpperCase();
  const existing = bySymbol.get(sym);
  if (!existing) {
    bySymbol.set(sym, {
      sentiment: s.sentiment,
      raw_sentiment: s.raw_sentiment,
      volume: s.volume,
      sources: [s.source_detail || s.source],
      best: { ...s, symbol: sym },
    });
    continue;
  }
  existing.sentiment += s.sentiment;
  existing.raw_sentiment = (existing.raw_sentiment + s.raw_sentiment) / 2;
  existing.volume += s.volume;
  if (!existing.sources.includes(s.source_detail || s.source)) {
    existing.sources.push(s.source_detail || s.source);
  }
  if (Math.abs(s.sentiment) > Math.abs(existing.best.sentiment)) {
    existing.best = { ...s, symbol: sym };
  }
}

const sourceCountBonus = (n: number) => (n >= 3 ? 1.4 : n >= 2 ? 1.2 : 1);

for (const [, v] of bySymbol) {
  const count = v.sources.length;
  const bonus = sourceCountBonus(count);
  const compositeScore = Math.abs(v.sentiment) * (v.best.source_weight ?? 0.8) * (v.best.freshness ?? 0.9) * bonus;
  merged.push({
    ...v.best,
    sentiment: v.sentiment,
    raw_sentiment: v.raw_sentiment,
    volume: v.volume,
    reason: count > 1 ? `${v.best.reason} (${count} sources)` : v.best.reason,
    source_count: count,
    quality_score: compositeScore,
  });
}
```

## 2) Where `min_sentiment_score` gates research

### 2.1 `researchTopSignals()` uses **raw** sentiment

The first gate is on `raw_sentiment` (not weighted). This ensures only inherently bullish content goes to LLM:

$$
\text{candidate} \iff \text{raw\_sentiment} \ge \text{min\_sentiment\_score}
$$

```3600:3639:src/durable-objects/mahoraga-harness.ts
private async researchTopSignals(limit = 10): Promise<ResearchResult[]> {
  const alpaca = createAlpacaProviders(this.env);
  const positions = await alpaca.trading.getPositions();
  const heldSymbols = new Set(positions.map((p) => p.symbol));

  const allSignals = this.state.signalCache;
  const notHeld = allSignals.filter((s) => !heldSymbols.has(s.symbol));
  // Use raw_sentiment for threshold (before weighting), weighted sentiment for sorting
  const aboveThreshold = notHeld.filter((s) => s.raw_sentiment >= this.state.config.min_sentiment_score);
  const candidates = aboveThreshold.sort((a, b) => b.sentiment - a.sentiment).slice(0, limit);

  if (candidates.length === 0) {
    this.log("SignalResearch", "no_candidates", {
      total_signals: allSignals.length,
      not_held: notHeld.length,
      above_threshold: aboveThreshold.length,
      min_sentiment: this.state.config.min_sentiment_score,
    });
    return [];
  }

  // Aggregate signals by symbol (combine sources for the same ticker)
  const aggregated = new Map<string, { symbol: string; sentiment: number; sources: string[] }>();
  for (const sig of candidates) {
    if (!aggregated.has(sig.symbol)) {
      aggregated.set(sig.symbol, { symbol: sig.symbol, sentiment: sig.sentiment, sources: [sig.source] });
    } else {
      aggregated.get(sig.symbol)!.sources.push(sig.source);
    }
  }

  // Batch all signals into a single LLM call for efficiency
  const batchInput = Array.from(aggregated.values());
  return this.researchSignalsBatch(batchInput);
}
```

### 2.2 `analyzeSignalsWithLLM()` uses **average** sentiment

The analyst step uses a looser threshold (half of `min_sentiment_score`) because it already aggregates multiple sources:

$$
\text{candidate} \iff \text{avgSentiment} \ge 0.5 \times \text{min\_sentiment\_score}
$$

```3728:3743:src/durable-objects/mahoraga-harness.ts
const aggregated = new Map<string, { symbol: string; sources: string[]; totalSentiment: number; count: number }>();
for (const sig of signals) {
  if (!aggregated.has(sig.symbol)) {
    aggregated.set(sig.symbol, { symbol: sig.symbol, sources: [], totalSentiment: 0, count: 0 });
  }
  const agg = aggregated.get(sig.symbol)!;
  agg.sources.push(sig.source);
  agg.totalSentiment += sig.sentiment;
  agg.count++;
}

const candidates = Array.from(aggregated.values())
  .map((a) => ({ ...a, avgSentiment: a.totalSentiment / a.count }))
  .filter((a) => a.avgSentiment >= this.state.config.min_sentiment_score * 0.5)
  .sort((a, b) => b.avgSentiment - a.avgSentiment)
  .slice(0, 10);
```

## 3) How LLM research is used

### 3.1 Per-signal research (batch)

Research is called periodically by the alarm loop:

```931:977:src/durable-objects/mahoraga-harness.ts
if (now - this.state.lastResearchRun >= RESEARCH_INTERVAL_MS) {
  await this.researchTopSignals(10);
  this.state.lastResearchRun = now;
}
```

The research prompt takes sentiment, sources, and price to produce a verdict + confidence:

```3246:3335:src/durable-objects/mahoraga-harness.ts
const prompt = `Should we BUY this ${isCrypto ? "crypto" : "stock"} based on social sentiment and fundamentals?

SYMBOL: ${symbol}
SENTIMENT: ${(sentimentScore * 100).toFixed(0)}% bullish (sources: ${sources.join(", ")})

CURRENT DATA:
- Price: $${price}

Evaluate if this is a good entry. Consider: Is the sentiment justified? Is it too late (already pumped)? Any red flags?

JSON response:
{
  "verdict": "BUY|SKIP|WAIT",
  "confidence": 0.0-1.0,
  "entry_quality": "excellent|good|fair|poor",
  "reasoning": "brief reason",
  "red_flags": ["any concerns"],
  "catalysts": ["positive factors"]
}`;
```

The output is cached in `state.signalResearch` for later trading decisions.

### 3.2 Analyst pass (LLM as final decider)

The analyst LLM aggregates candidates and current positions into **BUY / SELL / HOLD** recommendations:

```3709:3824:src/durable-objects/mahoraga-harness.ts
private async analyzeSignalsWithLLM(
  signals: Signal[],
  positions: Position[],
  account: Account
): Promise<{
  recommendations: Array<{
    action: "BUY" | "SELL" | "HOLD";
    symbol: string;
    confidence: number;
    reasoning: string;
    suggested_size_pct?: number;
  }>;
  market_summary: string;
  high_conviction: string[];
}> {
  ...
  const prompt = `Current Time: ${new Date().toISOString()}
...
TOP SENTIMENT CANDIDATES:
${candidates
  .map(
    (c) =>
      `- ${c.symbol}: avg sentiment ${(c.avgSentiment * 100).toFixed(0)}%, sources: ${c.sources.join(", ")}, ${positionSymbols.has(c.symbol) ? "[CURRENTLY HELD]" : "[NOT HELD]"}`
  )
  .join("\n")}
...
TRADING RULES:
- Max position size: $${this.state.config.max_position_value}
- Take profit target: ${this.state.config.take_profit_pct}%
- Stop loss: ${this.state.config.stop_loss_pct}%
- Min confidence to trade: ${this.state.config.min_analyst_confidence}
- Min hold time before selling: ${this.state.config.llm_min_hold_minutes ?? 30} minutes
`;
```

## 4) How this becomes trades

### 4.1 Per-signal research buys

In `runAnalyst()`, the system first executes buys backed by `signalResearch`:

$$
\text{buy} \iff \text{verdict}=\text{BUY} \land \text{confidence} \ge \text{min\_analyst\_confidence}
$$

```3935:3991:src/durable-objects/mahoraga-harness.ts
const researchedBuys = Object.values(this.state.signalResearch)
  .filter((r) => r.verdict === "BUY" && r.confidence >= this.state.config.min_analyst_confidence)
  .filter((r) => !heldSymbols.has(r.symbol))
  .filter((r) => !isCryptoSymbol(r.symbol, [...cryptoSymbolSet]))
  .sort((a, b) => b.confidence - a.confidence);

for (const research of researchedBuys.slice(0, 3)) {
  ...
  const result = await this.executeBuy(alpaca, research.symbol, finalConfidence, account);
  if (result) {
    this.state.positionEntries[research.symbol] = {
      symbol: research.symbol,
      entry_time: Date.now(),
      entry_price: 0,
      entry_sentiment: originalSignal?.sentiment || finalConfidence,
      entry_social_volume: originalSignal?.volume || 0,
      entry_sources: originalSignal?.subreddits || [originalSignal?.source || "research"],
      entry_reason: research.reasoning,
      peak_price: 0,
      peak_sentiment: originalSignal?.sentiment || finalConfidence,
    };
  }
}
```

### 4.2 Analyst LLM buys/sells

After per-signal buys, the analyst recommendations are applied:

```3994:4048:src/durable-objects/mahoraga-harness.ts
const analysis = await this.analyzeSignalsWithLLM(this.state.signalCache, positions, account);
const researchedSymbols = new Set(researchedBuys.map((r) => r.symbol));

for (const rec of analysis.recommendations) {
  if (rec.confidence < this.state.config.min_analyst_confidence) continue;

  if (rec.action === "SELL" && heldSymbols.has(rec.symbol)) {
    const entry = this.state.positionEntries[rec.symbol];
    const holdMinutes = entry ? (Date.now() - entry.entry_time) / (1000 * 60) : 0;
    const minHoldMinutes = this.state.config.llm_min_hold_minutes ?? 30;
    if (holdMinutes < minHoldMinutes) continue;

    await this.executeSell(alpaca, rec.symbol, `LLM recommendation: ${rec.reasoning}`);
    continue;
  }

  if (rec.action === "BUY") {
    if (positions.length >= this.state.config.max_positions) continue;
    if (heldSymbols.has(rec.symbol)) continue;
    if (researchedSymbols.has(rec.symbol)) continue;

    const result = await this.executeBuy(alpaca, rec.symbol, rec.confidence, account);
    if (result) {
      const originalSignal = this.state.signalCache.find((s) => s.symbol === rec.symbol);
      this.state.positionEntries[rec.symbol] = {
        symbol: rec.symbol,
        entry_time: Date.now(),
        entry_price: 0,
        entry_sentiment: originalSignal?.sentiment || rec.confidence,
        entry_social_volume: originalSignal?.volume || 0,
        entry_sources: originalSignal?.subreddits || [originalSignal?.source || "analyst"],
        entry_reason: rec.reasoning,
        peak_price: 0,
        peak_sentiment: originalSignal?.sentiment || rec.confidence,
      };
    }
  }
}
```

### 4.3 Position sizing (confidence-driven)

The buy size scales by confidence and is capped:

$$
\text{positionSize} = \min\Big(\text{cash} \cdot \frac{\text{sizePct}}{100} \cdot \text{confidence},\ \text{maxPositionValue}\Big)
$$

```4074:4089:src/durable-objects/mahoraga-harness.ts
const sizePct = Math.min(20, this.state.config.position_size_pct_of_cash);
const positionSize = Math.min(account.cash * (sizePct / 100) * confidence, this.state.config.max_position_value);

if (positionSize < 100) {
  this.log("Executor", "buy_skipped", { symbol, reason: "Position too small" });
  return false;
}
```

## 5) Summary of the decision chain

1) **Signals are gathered** from social/news/market sources and merged by symbol.  
2) **Raw sentiment** uses keyword counts; **weighted sentiment** uses decay, engagement, flair, and source weights.  
3) **`min_sentiment_score`** gates which signals go to LLM research (`raw_sentiment >= threshold`).  
4) **LLM research** outputs BUY/SKIP/WAIT + confidence per symbol, cached in `signalResearch`.  
5) **runAnalyst()** buys highest-confidence researched signals, then applies the analyst LLM to potentially buy/sell.  
6) **Execution** sizes positions by confidence and enforces risk constraints.
