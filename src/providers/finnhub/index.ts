/**
 * Finnhub API Provider — Equity fundamentals (market cap, P/E, dividend yield, 52-week H/L, etc.)
 *
 * Free tier: 60 calls/minute, no daily cap, no symbol restrictions for US equities.
 * Endpoint: GET /api/v1/stock/metric?symbol=AAPL&metric=all&token=KEY
 */

const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";
const CACHE_TTL_SECONDS = 900; // 15 minutes

export interface FinnhubMetrics {
  marketCapitalization: number | null;
  peBasicExclExtraTTM: number | null;
  dividendYieldIndicatedAnnual: number | null;
  "52WeekHigh": number | null;
  "52WeekLow": number | null;
  "10DayAverageTradingVolume": number | null;
  "3MonthAverageTradingVolume": number | null;
  beta: number | null;
}

interface FinnhubMetricResponse {
  metric: Record<string, number | null>;
  metricType: string;
  symbol: string;
}

export interface FinnhubNewsItem {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export interface FinnhubInsiderTransaction {
  name: string;
  share: number;
  change: number;
  filingDate: string;
  transactionDate: string;
  transactionCode: string;
  transactionPrice?: number;
  symbol: string;
}

export interface FinnhubUpgradeDowngradeItem {
  symbol: string;
  gradeTime: number;
  company: string;
  fromGrade: string;
  toGrade: string;
  action: string;
}

export class FinnhubProvider {
  constructor(
    private apiKey: string,
    private cache?: KVNamespace
  ) {}

  async getMetrics(symbol: string): Promise<FinnhubMetrics | null> {
    const cacheKey = `finnhub:metric:${symbol}`;

    // Check KV cache first
    if (this.cache) {
      try {
        const cached = await this.cache.get(cacheKey, "json");
        if (cached) {
          console.log(`[MahoragaHarness] Finnhub metrics for ${symbol}: cache hit`);
          return cached as FinnhubMetrics;
        }
      } catch {
        // Cache miss, continue to fetch
      }
    }

    try {
      const url = `${FINNHUB_BASE_URL}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${this.apiKey}`;
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        console.log(`[MahoragaHarness] Finnhub error for ${symbol}: HTTP ${response.status}`);
        return null;
      }

      const data: FinnhubMetricResponse = await response.json();

      if (!data.metric) {
        console.log(`[MahoragaHarness] Finnhub error for ${symbol}: no metric data in response`);
        return null;
      }

      const metrics: FinnhubMetrics = {
        marketCapitalization: data.metric.marketCapitalization ?? null,
        peBasicExclExtraTTM: data.metric.peBasicExclExtraTTM ?? null,
        dividendYieldIndicatedAnnual: data.metric.dividendYieldIndicatedAnnual ?? null,
        "52WeekHigh": data.metric["52WeekHigh"] ?? null,
        "52WeekLow": data.metric["52WeekLow"] ?? null,
        "10DayAverageTradingVolume": data.metric["10DayAverageTradingVolume"] ?? null,
        "3MonthAverageTradingVolume": data.metric["3MonthAverageTradingVolume"] ?? null,
        beta: data.metric.beta ?? null,
      };

      console.log(
        `[MahoragaHarness] Finnhub metrics for ${symbol}: marketCap=${metrics.marketCapitalization}M, PE=${metrics.peBasicExclExtraTTM}, divYield=${metrics.dividendYieldIndicatedAnnual}%, 52wkH=${metrics["52WeekHigh"]}, 52wkL=${metrics["52WeekLow"]}, avgVol=${metrics["10DayAverageTradingVolume"]}M`
      );

      // Store in cache
      if (this.cache) {
        try {
          await this.cache.put(cacheKey, JSON.stringify(metrics), { expirationTtl: CACHE_TTL_SECONDS });
        } catch {
          // Non-critical cache write failure
        }
      }

      return metrics;
    } catch (error) {
      console.log(`[MahoragaHarness] Finnhub error for ${symbol}: ${error}`);
      return null;
    }
  }

  // --- Market-wide signal endpoints (free tier) ---

  async getMarketNews(): Promise<FinnhubNewsItem[]> {
    const cacheKey = "finnhub:news:general";

    if (this.cache) {
      try {
        const cached = await this.cache.get(cacheKey, "json");
        if (cached) return cached as FinnhubNewsItem[];
      } catch {
        // continue
      }
    }

    try {
      const url = `${FINNHUB_BASE_URL}/news?category=general&token=${this.apiKey}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) return [];
      const data = (await response.json()) as FinnhubNewsItem[];
      if (this.cache) {
        try {
          await this.cache.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL_SECONDS });
        } catch {
          // non-critical
        }
      }
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.log(`[Finnhub] getMarketNews error: ${error}`);
      return [];
    }
  }

  async getInsiderTransactions(symbol?: string): Promise<FinnhubInsiderTransaction[]> {
    const cacheKey = symbol ? `finnhub:insider:${symbol}` : "finnhub:insider:latest";
    if (this.cache) {
      try {
        const cached = await this.cache.get(cacheKey, "json");
        if (cached) return (cached as { data: FinnhubInsiderTransaction[] }).data ?? [];
      } catch {
        // continue
      }
    }

    try {
      const params = new URLSearchParams({ token: this.apiKey });
      if (symbol) params.set("symbol", symbol);
      const url = `${FINNHUB_BASE_URL}/stock/insider-transactions?${params}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) return [];
      const data = (await response.json()) as { data?: FinnhubInsiderTransaction[]; symbol?: string };
      const list = Array.isArray(data?.data) ? data.data : [];
      if (this.cache) {
        try {
          await this.cache.put(cacheKey, JSON.stringify({ data: list }), { expirationTtl: CACHE_TTL_SECONDS });
        } catch {
          // non-critical
        }
      }
      return list;
    } catch (error) {
      console.log(`[Finnhub] getInsiderTransactions error: ${error}`);
      return [];
    }
  }

  async getUpgradeDowngrade(symbol?: string, from?: string, to?: string): Promise<FinnhubUpgradeDowngradeItem[]> {
    const cacheKey = symbol
      ? `finnhub:upgrade:${symbol}`
      : `finnhub:upgrade:${from ?? "none"}-${to ?? "none"}`;
    if (this.cache) {
      try {
        const cached = await this.cache.get(cacheKey, "json");
        if (cached) return cached as FinnhubUpgradeDowngradeItem[];
      } catch {
        // continue
      }
    }

    try {
      const params = new URLSearchParams({ token: this.apiKey });
      if (symbol) params.set("symbol", symbol);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const url = `${FINNHUB_BASE_URL}/stock/upgrade-downgrade?${params}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) return [];
      const data = (await response.json()) as FinnhubUpgradeDowngradeItem[];
      const list = Array.isArray(data) ? data : [];
      if (this.cache && list.length > 0) {
        try {
          await this.cache.put(cacheKey, JSON.stringify(list), { expirationTtl: CACHE_TTL_SECONDS });
        } catch {
          // non-critical
        }
      }
      return list;
    } catch (error) {
      console.log(`[Finnhub] getUpgradeDowngrade error: ${error}`);
      return [];
    }
  }

  async getRecommendationTrends(symbol: string): Promise<{ buy: number; hold: number; sell: number; strongBuy: number; strongSell: number; period: string }[] | null> {
    const cacheKey = `finnhub:recommendation:${symbol}`;
    if (this.cache) {
      try {
        const cached = await this.cache.get(cacheKey, "json");
        if (cached) return cached as { buy: number; hold: number; sell: number; strongBuy: number; strongSell: number; period: string }[];
      } catch {
        // continue
      }
    }

    try {
      const url = `${FINNHUB_BASE_URL}/stock/recommendation?symbol=${encodeURIComponent(symbol)}&token=${this.apiKey}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) return null;
      const data = await response.json();
      const list = Array.isArray(data) ? data : null;
      if (this.cache && list) {
        try {
          await this.cache.put(cacheKey, JSON.stringify(list), { expirationTtl: CACHE_TTL_SECONDS });
        } catch {
          // non-critical
        }
      }
      return list;
    } catch (error) {
      console.log(`[Finnhub] getRecommendationTrends error for ${symbol}: ${error}`);
      return null;
    }
  }
}

export function createFinnhubProvider(apiKey: string, cache?: KVNamespace): FinnhubProvider {
  return new FinnhubProvider(apiKey, cache);
}
