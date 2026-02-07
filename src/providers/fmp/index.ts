/**
 * Financial Modeling Prep (FMP) Provider — Crypto market data
 *
 * Free tier: 250 calls/day, limited to sample symbols for equities.
 * Covers major crypto pairs (BTCUSD, ETHUSD, SOLUSD + ~94 more).
 * Endpoint: GET /stable/quote?symbol=BTCUSD&apikey=KEY
 */

const FMP_BASE_URL = "https://financialmodelingprep.com";
const CACHE_TTL_SECONDS = 300; // 5 minutes (crypto trades 24/7)
const CACHE_TTL_SCREENER = 1800; // 30 minutes for screener to conserve 250/day

export interface FMPCryptoQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercentage: number;
  volume: number;
  dayHigh: number;
  dayLow: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
  open: number;
  previousClose: number;
  priceAvg50: number;
  priceAvg200: number;
}

export interface FMPStockMover {
  symbol: string;
  name: string;
  price: number;
  changesPercentage?: number;
  change?: number;
  volume?: number;
}

export class FMPProvider {
  constructor(
    private apiKey: string,
    private cache?: KVNamespace
  ) {}

  async getCryptoQuote(symbol: string): Promise<FMPCryptoQuote | null> {
    const cacheKey = `fmp:crypto:${symbol}`;

    // Check KV cache first
    if (this.cache) {
      try {
        const cached = await this.cache.get(cacheKey, "json");
        if (cached) {
          console.log(`[MahoragaHarness] FMP crypto quote for ${symbol}: cache hit`);
          return cached as FMPCryptoQuote;
        }
      } catch {
        // Cache miss, continue to fetch
      }
    }

    try {
      const url = `${FMP_BASE_URL}/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${this.apiKey}`;
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        console.log(`[MahoragaHarness] FMP error for ${symbol}: HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();

      // FMP returns an array with one element
      const quote = Array.isArray(data) ? data[0] : data;
      if (!quote || !quote.symbol) {
        console.log(`[MahoragaHarness] FMP error for ${symbol}: no quote data in response`);
        return null;
      }

      const result: FMPCryptoQuote = {
        symbol: quote.symbol,
        name: quote.name || symbol,
        price: quote.price || 0,
        change: quote.change || 0,
        changePercentage: quote.changePercentage || 0,
        volume: quote.volume || 0,
        dayHigh: quote.dayHigh || 0,
        dayLow: quote.dayLow || 0,
        yearHigh: quote.yearHigh || 0,
        yearLow: quote.yearLow || 0,
        marketCap: quote.marketCap || 0,
        open: quote.open || 0,
        previousClose: quote.previousClose || 0,
        priceAvg50: quote.priceAvg50 || 0,
        priceAvg200: quote.priceAvg200 || 0,
      };

      console.log(
        `[MahoragaHarness] FMP crypto quote for ${symbol}: price=${result.price}, marketCap=${result.marketCap}, yearH=${result.yearHigh}, yearL=${result.yearLow}`
      );

      // Store in cache
      if (this.cache) {
        try {
          await this.cache.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });
        } catch {
          // Non-critical cache write failure
        }
      }

      return result;
    } catch (error) {
      console.log(`[MahoragaHarness] FMP error for ${symbol}: ${error}`);
      return null;
    }
  }

  async getMarketGainers(): Promise<FMPStockMover[]> {
    const cacheKey = "fmp:gainers";
    if (this.cache) {
      try {
        const cached = await this.cache.get(cacheKey, "json");
        if (cached) return cached as FMPStockMover[];
      } catch {
        // continue
      }
    }
    try {
      const url = `${FMP_BASE_URL}/stable/biggest-gainers?apikey=${this.apiKey}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) return [];
      const data = await response.json();
      const list = Array.isArray(data) ? (data as FMPStockMover[]) : [];
      if (this.cache) {
        try {
          await this.cache.put(cacheKey, JSON.stringify(list), { expirationTtl: CACHE_TTL_SCREENER });
        } catch {
          // non-critical
        }
      }
      return list;
    } catch (error) {
      console.log(`[FMP] getMarketGainers error: ${error}`);
      return [];
    }
  }

  async getMarketLosers(): Promise<FMPStockMover[]> {
    const cacheKey = "fmp:losers";
    if (this.cache) {
      try {
        const cached = await this.cache.get(cacheKey, "json");
        if (cached) return cached as FMPStockMover[];
      } catch {
        // continue
      }
    }
    try {
      const url = `${FMP_BASE_URL}/stable/biggest-losers?apikey=${this.apiKey}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) return [];
      const data = await response.json();
      const list = Array.isArray(data) ? (data as FMPStockMover[]) : [];
      if (this.cache) {
        try {
          await this.cache.put(cacheKey, JSON.stringify(list), { expirationTtl: CACHE_TTL_SCREENER });
        } catch {
          // non-critical
        }
      }
      return list;
    } catch (error) {
      console.log(`[FMP] getMarketLosers error: ${error}`);
      return [];
    }
  }

  async getMostActive(): Promise<FMPStockMover[]> {
    const cacheKey = "fmp:actives";
    if (this.cache) {
      try {
        const cached = await this.cache.get(cacheKey, "json");
        if (cached) return cached as FMPStockMover[];
      } catch {
        // continue
      }
    }
    try {
      const url = `${FMP_BASE_URL}/stable/most-active?apikey=${this.apiKey}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) return [];
      const data = await response.json();
      const list = Array.isArray(data) ? (data as FMPStockMover[]) : [];
      if (this.cache) {
        try {
          await this.cache.put(cacheKey, JSON.stringify(list), { expirationTtl: CACHE_TTL_SCREENER });
        } catch {
          // non-critical
        }
      }
      return list;
    } catch (error) {
      console.log(`[FMP] getMostActive error: ${error}`);
      return [];
    }
  }
}

export function createFMPProvider(apiKey: string, cache?: KVNamespace): FMPProvider {
  return new FMPProvider(apiKey, cache);
}
