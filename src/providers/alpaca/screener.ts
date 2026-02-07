import type { AlpacaClient } from "./client";

export interface AlpacaScreenerMover {
  symbol: string;
  changePercentage?: number;
  change?: number;
  volume?: number;
}

export interface AlpacaNewsItem {
  id: number;
  headline?: string;
  summary?: string;
  symbols?: string[];
  created_at?: string;
}

export interface AlpacaScreenerProvider {
  getMostActives(): Promise<AlpacaScreenerMover[]>;
  getMovers(): Promise<{ gainers: AlpacaScreenerMover[]; losers: AlpacaScreenerMover[] }>;
  getNews(params?: { limit?: number }): Promise<AlpacaNewsItem[]>;
}

function normalizeMovers(data: unknown): AlpacaScreenerMover[] {
  if (Array.isArray(data)) {
    return data.map((item) => ({
      symbol: (item as { symbol?: string }).symbol ?? (item as { ticker?: string }).ticker ?? "",
      changePercentage: (item as { change_percentage?: number }).change_percentage ?? (item as { changePercentage?: number }).changePercentage,
      change: (item as { change?: number }).change,
      volume: (item as { volume?: number }).volume,
    })).filter((m) => m.symbol);
  }
  const obj = data as Record<string, unknown>;
  if (obj && typeof obj === "object") {
    const symbols = (obj.symbols as string[] | undefined) ?? (obj.most_actives as AlpacaScreenerMover[] | undefined);
    if (Array.isArray(symbols)) {
      return symbols.map((s) => (typeof s === "string" ? { symbol: s } : s)).filter((m) => m.symbol);
    }
  }
  return [];
}

export function createAlpacaScreenerProvider(client: AlpacaClient): AlpacaScreenerProvider {
  return {
    async getMostActives(): Promise<AlpacaScreenerMover[]> {
      try {
        const res = await client.dataRequest<unknown>("GET", "/v1beta1/screener/stocks/most-actives");
        return normalizeMovers(res);
      } catch {
        return [];
      }
    },

    async getMovers(): Promise<{ gainers: AlpacaScreenerMover[]; losers: AlpacaScreenerMover[] }> {
      try {
        const res = await client.dataRequest<{ gainers?: unknown; losers?: unknown } | unknown>(
          "GET",
          "/v1beta1/screener/stocks/movers"
        );
        const obj = res as Record<string, unknown>;
        return {
          gainers: normalizeMovers(obj?.gainers ?? []),
          losers: normalizeMovers(obj?.losers ?? []),
        };
      } catch {
        return { gainers: [], losers: [] };
      }
    },

    async getNews(params?: { limit?: number }): Promise<AlpacaNewsItem[]> {
      try {
        const limit = params?.limit ?? 50;
        const res = await client.dataRequest<{ news?: AlpacaNewsItem[] } | AlpacaNewsItem[]>(
          "GET",
          "/v1beta1/news",
          { limit }
        );
        if (Array.isArray(res)) return res;
        const arr = (res as { news?: AlpacaNewsItem[] }).news;
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    },
  };
}
