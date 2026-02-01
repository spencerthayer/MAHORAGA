/**
 * TradingAgentDO - Agentic Durable Object trading agent
 * 
 * An LLM-powered trading agent that runs on Cloudflare Workers.
 * Uses OpenAI to analyze signals and make trading decisions.
 * 
 * Features:
 * - StockTwits sentiment monitoring
 * - LLM-powered signal analysis and research
 * - LLM-powered position management
 * - Stop-loss and take-profit
 * - Configurable trading parameters
 * - Dashboard API for monitoring
 */

import { DurableObject } from "cloudflare:workers";
import OpenAI from "openai";
import type { Env } from "../env.d";
import { createAlpacaProviders } from "../providers/alpaca";
import type { Account, Position, MarketClock } from "../providers/types";

// ============================================================================
// Types
// ============================================================================

interface AgentConfig {
  data_poll_interval_ms: number;
  analyst_interval_ms: number;
  max_position_value: number;
  max_positions: number;
  min_sentiment_score: number;
  min_analyst_confidence: number;
  min_volume: number;
  take_profit_pct: number;
  stop_loss_pct: number;
  position_size_pct_of_cash: number;
  llm_model: string;
}

interface Signal {
  symbol: string;
  source: string;
  sentiment: number;
  volume: number;
  bullish: number;
  bearish: number;
  reason: string;
}

interface ResearchResult {
  symbol: string;
  verdict: "BUY" | "SKIP" | "WAIT";
  confidence: number;
  reasoning: string;
  red_flags: string[];
  catalysts: string[];
  timestamp: number;
}

interface LogEntry {
  timestamp: string;
  agent: string;
  action: string;
  [key: string]: unknown;
}

interface CostTracker {
  total_usd: number;
  calls: number;
  tokens_in: number;
  tokens_out: number;
}

interface AgentState {
  config: AgentConfig;
  signalCache: Signal[];
  signalResearch: Record<string, ResearchResult>;
  logs: LogEntry[];
  costTracker: CostTracker;
  lastDataGatherRun: number;
  lastAnalystRun: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: AgentConfig = {
  data_poll_interval_ms: 60_000,
  analyst_interval_ms: 120_000,
  max_position_value: 2000,
  max_positions: 3,
  min_sentiment_score: 0.3,
  min_analyst_confidence: 0.6,
  min_volume: 10,
  take_profit_pct: 8,
  stop_loss_pct: 4,
  position_size_pct_of_cash: 20,
  llm_model: "gpt-4o-mini",
};

const DEFAULT_STATE: AgentState = {
  config: DEFAULT_CONFIG,
  signalCache: [],
  signalResearch: {},
  logs: [],
  costTracker: { total_usd: 0, calls: 0, tokens_in: 0, tokens_out: 0 },
  lastDataGatherRun: 0,
  lastAnalystRun: 0,
  enabled: false,
};

// ============================================================================
// TradingAgentDO
// ============================================================================

export class TradingAgentDO extends DurableObject<Env> {
  private state: AgentState = { ...DEFAULT_STATE };
  private openai: OpenAI | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    
    if (env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    }
    
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<AgentState>("state");
      if (stored) {
        this.state = { ...DEFAULT_STATE, ...stored };
      }
    });
  }

  // ============================================================================
  // Alarm Handler
  // ============================================================================

  async alarm(): Promise<void> {
    if (!this.state.enabled) {
      this.log("System", "alarm_skipped", { reason: "Agent not enabled" });
      return;
    }

    const now = Date.now();
    
    try {
      const alpaca = createAlpacaProviders(this.env);
      const clock = await alpaca.trading.getClock();
      
      if (now - this.state.lastDataGatherRun >= this.state.config.data_poll_interval_ms) {
        await this.runDataGatherer();
        this.state.lastDataGatherRun = now;
      }
      
      if (clock.is_open) {
        if (now - this.state.lastAnalystRun >= this.state.config.analyst_interval_ms) {
          await this.runTradingLogic();
          this.state.lastAnalystRun = now;
        }
      }
      
      await this.persist();
    } catch (error) {
      this.log("System", "alarm_error", { error: String(error) });
    }
    
    await this.scheduleNextAlarm();
  }

  private async scheduleNextAlarm(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + 30_000);
  }

  // ============================================================================
  // HTTP Handler
  // ============================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);

    try {
      switch (action) {
        case "status":
          return this.handleStatus();
        case "config":
          if (request.method === "POST") {
            return this.handleUpdateConfig(request);
          }
          return this.jsonResponse({ config: this.state.config });
        case "enable":
          return this.handleEnable();
        case "disable":
          return this.handleDisable();
        case "logs":
          return this.handleGetLogs(url);
        case "signals":
          return this.jsonResponse({ signals: this.state.signalCache });
        case "research":
          return this.jsonResponse({ research: this.state.signalResearch });
        case "costs":
          return this.jsonResponse({ costs: this.state.costTracker });
        case "trigger":
          await this.alarm();
          return this.jsonResponse({ ok: true, message: "Alarm triggered" });
        default:
          return new Response("Not found", { status: 404 });
      }
    } catch (error) {
      return new Response(
        JSON.stringify({ error: String(error) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  private async handleStatus(): Promise<Response> {
    const alpaca = createAlpacaProviders(this.env);
    
    let account: Account | null = null;
    let positions: Position[] = [];
    let clock: MarketClock | null = null;
    
    try {
      [account, positions, clock] = await Promise.all([
        alpaca.trading.getAccount(),
        alpaca.trading.getPositions(),
        alpaca.trading.getClock(),
      ]);
    } catch {
      // Will return null values
    }
    
    return this.jsonResponse({
      enabled: this.state.enabled,
      account,
      positions,
      clock,
      config: this.state.config,
      signalCount: this.state.signalCache.length,
      researchCount: Object.keys(this.state.signalResearch).length,
      costTracker: this.state.costTracker,
      lastDataGatherRun: this.state.lastDataGatherRun,
      lastAnalystRun: this.state.lastAnalystRun,
    });
  }

  private async handleUpdateConfig(request: Request): Promise<Response> {
    const body = await request.json() as Partial<AgentConfig>;
    this.state.config = { ...this.state.config, ...body };
    await this.persist();
    return this.jsonResponse({ ok: true, config: this.state.config });
  }

  private async handleEnable(): Promise<Response> {
    this.state.enabled = true;
    await this.persist();
    await this.scheduleNextAlarm();
    this.log("System", "agent_enabled", {});
    return this.jsonResponse({ ok: true, enabled: true });
  }

  private async handleDisable(): Promise<Response> {
    this.state.enabled = false;
    await this.ctx.storage.deleteAlarm();
    await this.persist();
    this.log("System", "agent_disabled", {});
    return this.jsonResponse({ ok: true, enabled: false });
  }

  private handleGetLogs(url: URL): Response {
    const limit = parseInt(url.searchParams.get("limit") || "100");
    const logs = this.state.logs.slice(-limit);
    return this.jsonResponse({ logs });
  }

  // ============================================================================
  // Data Gathering
  // ============================================================================

  private async runDataGatherer(): Promise<void> {
    this.log("System", "gathering_data", {});
    
    const signals = await this.gatherStockTwits();
    this.state.signalCache = signals;
    
    if (this.openai && signals.length > 0) {
      await this.researchTopSignals(5);
    }
    
    this.log("System", "data_gathered", { 
      signals: signals.length,
      researched: Object.keys(this.state.signalResearch).length,
    });
  }

  private async gatherStockTwits(): Promise<Signal[]> {
    const signals: Signal[] = [];
    
    try {
      const trendingRes = await fetch("https://api.stocktwits.com/api/2/trending/symbols.json");
      if (!trendingRes.ok) return [];
      const trendingData = await trendingRes.json() as { symbols?: Array<{ symbol: string }> };
      const trending = trendingData.symbols || [];
      
      for (const sym of trending.slice(0, 15)) {
        try {
          const streamRes = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${sym.symbol}.json?limit=30`);
          if (!streamRes.ok) continue;
          const streamData = await streamRes.json() as { 
            messages?: Array<{ entities?: { sentiment?: { basic?: string } } }> 
          };
          const messages = streamData.messages || [];
          
          let bullish = 0, bearish = 0;
          for (const msg of messages) {
            const sentiment = msg.entities?.sentiment?.basic;
            if (sentiment === "Bullish") bullish++;
            else if (sentiment === "Bearish") bearish++;
          }
          
          const total = messages.length;
          const score = total > 0 ? (bullish - bearish) / total : 0;
          
          if (total >= 5) {
            signals.push({
              symbol: sym.symbol,
              source: "stocktwits",
              sentiment: score,
              volume: total,
              bullish,
              bearish,
              reason: `StockTwits: ${bullish}B/${bearish}b (${(score * 100).toFixed(0)}%)`,
            });
          }
          
          await this.sleep(200);
        } catch {
          continue;
        }
      }
    } catch (error) {
      this.log("StockTwits", "error", { message: String(error) });
    }
    
    return signals;
  }

  // ============================================================================
  // LLM Research
  // ============================================================================

  private async researchSignal(signal: Signal): Promise<ResearchResult | null> {
    if (!this.openai) return null;

    const CACHE_TTL_MS = 300_000;
    const cached = this.state.signalResearch[signal.symbol];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached;
    }

    try {
      const alpaca = createAlpacaProviders(this.env);
      const quote = await alpaca.marketData.getQuote(signal.symbol).catch(() => null);
      const price = quote?.ask_price || quote?.bid_price || 0;

      const prompt = `Analyze this trading signal and decide if we should buy:

SYMBOL: ${signal.symbol}
SENTIMENT: ${(signal.sentiment * 100).toFixed(0)}% bullish
SOURCE: ${signal.source} (${signal.volume} messages: ${signal.bullish} bullish, ${signal.bearish} bearish)
CURRENT PRICE: $${price || "unknown"}

Consider:
1. Is the sentiment score strong enough to indicate real momentum?
2. Is there enough volume to trust the signal?
3. Are there any red flags (pump and dump patterns, low liquidity tickers)?
4. What catalysts might be driving this sentiment?

Respond with JSON only:
{
  "verdict": "BUY" | "SKIP" | "WAIT",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "red_flags": ["any concerns"],
  "catalysts": ["positive factors"]
}`;

      const response = await this.openai.chat.completions.create({
        model: this.state.config.llm_model,
        messages: [
          { role: "system", content: "You are a skeptical stock analyst. Be cautious of hype. Output valid JSON only." },
          { role: "user", content: prompt },
        ],
        max_tokens: 300,
        temperature: 0.3,
      });

      if (response.usage) {
        this.trackLLMCost(response.usage.prompt_tokens, response.usage.completion_tokens);
      }

      const content = response.choices[0]?.message?.content || "{}";
      const analysis = JSON.parse(content.replace(/```json\n?|```/g, "").trim()) as {
        verdict: "BUY" | "SKIP" | "WAIT";
        confidence: number;
        reasoning: string;
        red_flags: string[];
        catalysts: string[];
      };

      const result: ResearchResult = {
        symbol: signal.symbol,
        verdict: analysis.verdict,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        red_flags: analysis.red_flags || [],
        catalysts: analysis.catalysts || [],
        timestamp: Date.now(),
      };

      this.state.signalResearch[signal.symbol] = result;
      this.log("Research", "signal_analyzed", {
        symbol: signal.symbol,
        verdict: result.verdict,
        confidence: result.confidence,
      });

      return result;
    } catch (error) {
      this.log("Research", "error", { symbol: signal.symbol, message: String(error) });
      return null;
    }
  }

  private async researchTopSignals(limit: number): Promise<void> {
    const candidates = this.state.signalCache
      .filter(s => s.sentiment >= this.state.config.min_sentiment_score)
      .sort((a, b) => b.sentiment - a.sentiment)
      .slice(0, limit);

    for (const signal of candidates) {
      await this.researchSignal(signal);
      await this.sleep(500);
    }
  }

  private async analyzePosition(position: Position): Promise<{
    action: "HOLD" | "SELL";
    confidence: number;
    reasoning: string;
  } | null> {
    if (!this.openai) return null;

    const plPct = (position.unrealized_pl / (position.market_value - position.unrealized_pl)) * 100;
    const currentSignal = this.state.signalCache.find(s => s.symbol === position.symbol);

    const prompt = `Analyze this position and recommend HOLD or SELL:

POSITION: ${position.symbol}
SHARES: ${position.qty}
CURRENT P&L: ${plPct >= 0 ? "+" : ""}${plPct.toFixed(2)}%
MARKET VALUE: $${position.market_value.toFixed(2)}
CURRENT PRICE: $${position.current_price}

CURRENT SENTIMENT: ${currentSignal 
  ? `${(currentSignal.sentiment * 100).toFixed(0)}% bullish (${currentSignal.volume} messages)`
  : "No recent data"}

RULES:
- Take profit target: ${this.state.config.take_profit_pct}%
- Stop loss: ${this.state.config.stop_loss_pct}%

Consider:
1. Is sentiment still supportive or deteriorating?
2. Has the position reached a natural exit point?
3. Are there signs the move is exhausted?

Respond with JSON only:
{
  "action": "HOLD" | "SELL",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.state.config.llm_model,
        messages: [
          { role: "system", content: "You are a position manager. Protect profits and cut losses. Output valid JSON only." },
          { role: "user", content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.3,
      });

      if (response.usage) {
        this.trackLLMCost(response.usage.prompt_tokens, response.usage.completion_tokens);
      }

      const content = response.choices[0]?.message?.content || "{}";
      const analysis = JSON.parse(content.replace(/```json\n?|```/g, "").trim()) as {
        action: "HOLD" | "SELL";
        confidence: number;
        reasoning: string;
      };

      this.log("Research", "position_analyzed", {
        symbol: position.symbol,
        action: analysis.action,
        confidence: analysis.confidence,
      });

      return analysis;
    } catch (error) {
      this.log("Research", "position_error", { symbol: position.symbol, message: String(error) });
      return null;
    }
  }

  // ============================================================================
  // Trading Logic
  // ============================================================================

  private async runTradingLogic(): Promise<void> {
    const alpaca = createAlpacaProviders(this.env);
    
    const [account, positions, clock] = await Promise.all([
      alpaca.trading.getAccount(),
      alpaca.trading.getPositions(),
      alpaca.trading.getClock(),
    ]);
    
    if (!account || !clock.is_open) {
      this.log("System", "trading_skipped", { reason: "Account unavailable or market closed" });
      return;
    }
    
    const heldSymbols = new Set(positions.map(p => p.symbol));

    for (const pos of positions) {
      const plPct = (pos.unrealized_pl / (pos.market_value - pos.unrealized_pl)) * 100;
      
      if (plPct >= this.state.config.take_profit_pct) {
        await this.executeSell(alpaca, pos.symbol, `Take profit at +${plPct.toFixed(1)}%`);
        continue;
      }
      
      if (plPct <= -this.state.config.stop_loss_pct) {
        await this.executeSell(alpaca, pos.symbol, `Stop loss at ${plPct.toFixed(1)}%`);
        continue;
      }

      if (this.openai) {
        const analysis = await this.analyzePosition(pos);
        if (analysis?.action === "SELL" && analysis.confidence >= 0.7) {
          await this.executeSell(alpaca, pos.symbol, `LLM: ${analysis.reasoning}`);
        }
      }
    }

    if (positions.length >= this.state.config.max_positions) {
      this.log("System", "max_positions_reached", { count: positions.length });
      return;
    }

    const buyOpportunities = Object.values(this.state.signalResearch)
      .filter(r => r.verdict === "BUY")
      .filter(r => r.confidence >= this.state.config.min_analyst_confidence)
      .filter(r => !heldSymbols.has(r.symbol))
      .filter(r => Date.now() - r.timestamp < 600_000)
      .sort((a, b) => b.confidence - a.confidence);

    this.log("System", "buy_opportunities", { 
      count: buyOpportunities.length,
      symbols: buyOpportunities.map(o => o.symbol),
    });

    for (const opportunity of buyOpportunities.slice(0, 1)) {
      if (positions.length >= this.state.config.max_positions) break;

      const result = await this.executeBuy(alpaca, opportunity.symbol, opportunity.confidence, account);
      if (result) {
        heldSymbols.add(opportunity.symbol);
        break;
      }
    }
  }

  private async executeBuy(
    alpaca: ReturnType<typeof createAlpacaProviders>,
    symbol: string,
    confidence: number,
    account: Account
  ): Promise<boolean> {
    const sizePct = this.state.config.position_size_pct_of_cash;
    const positionSize = Math.min(
      account.cash * (sizePct / 100) * confidence,
      this.state.config.max_position_value
    );
    
    if (positionSize < 100) {
      this.log("Executor", "buy_skipped", { symbol, reason: "Position too small" });
      return false;
    }
    
    try {
      const order = await alpaca.trading.createOrder({
        symbol,
        notional: Math.round(positionSize * 100) / 100,
        side: "buy",
        type: "market",
        time_in_force: "day",
      });
      
      this.log("Executor", "buy_executed", { 
        symbol, 
        status: order.status, 
        size: positionSize,
        confidence,
      });
      return true;
    } catch (error) {
      this.log("Executor", "buy_failed", { symbol, error: String(error) });
      return false;
    }
  }

  private async executeSell(
    alpaca: ReturnType<typeof createAlpacaProviders>,
    symbol: string,
    reason: string
  ): Promise<boolean> {
    try {
      await alpaca.trading.closePosition(symbol);
      this.log("Executor", "sell_executed", { symbol, reason });
      delete this.state.signalResearch[symbol];
      return true;
    } catch (error) {
      this.log("Executor", "sell_failed", { symbol, error: String(error) });
      return false;
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private trackLLMCost(tokensIn: number, tokensOut: number): void {
    const pricing: Record<string, { input: number; output: number }> = {
      "gpt-4o": { input: 2.5, output: 10 },
      "gpt-4o-mini": { input: 0.15, output: 0.6 },
    };
    
    const rates = pricing[this.state.config.llm_model] ?? pricing["gpt-4o-mini"]!;
    const cost = (tokensIn * rates.input + tokensOut * rates.output) / 1_000_000;
    
    this.state.costTracker.total_usd += cost;
    this.state.costTracker.calls++;
    this.state.costTracker.tokens_in += tokensIn;
    this.state.costTracker.tokens_out += tokensOut;
  }

  private log(agent: string, action: string, details: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      agent,
      action,
      ...details,
    };
    this.state.logs.push(entry);
    
    if (this.state.logs.length > 500) {
      this.state.logs = this.state.logs.slice(-500);
    }
    
    console.log(`[${entry.timestamp}] [${agent}] ${action}`, JSON.stringify(details));
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put("state", this.state);
  }

  private jsonResponse(data: unknown): Response {
    return new Response(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Helpers
// ============================================================================

export function getTradingAgentStub(env: Env): DurableObjectStub {
  const id = env.TRADING_AGENT.idFromName("main");
  return env.TRADING_AGENT.get(id);
}

export async function getTradingAgentStatus(env: Env): Promise<unknown> {
  const stub = getTradingAgentStub(env);
  const response = await stub.fetch(new Request("http://agent/status"));
  return response.json();
}

export async function enableTradingAgent(env: Env): Promise<void> {
  const stub = getTradingAgentStub(env);
  await stub.fetch(new Request("http://agent/enable"));
}

export async function disableTradingAgent(env: Env): Promise<void> {
  const stub = getTradingAgentStub(env);
  await stub.fetch(new Request("http://agent/disable"));
}
