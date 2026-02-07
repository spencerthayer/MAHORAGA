/**
 * Quiver Quantitative API Provider — WSB, Congress trading, insider transactions, off-exchange short volume.
 * API: https://api.quiverquant.com/beta/
 * Auth: Authorization: Token <token>
 */

const QUIVER_BASE = "https://api.quiverquant.com/beta";

export interface QuiverWSBRow {
  Ticker?: string;
  Company?: string;
  Date?: string;
  Time?: string;
  Mentions?: number;
  Bullish?: number;
  Bearish?: number;
  [key: string]: unknown;
}

export interface QuiverCongressRow {
  Ticker?: string;
  Representative?: string;
  TransactionDate?: string;
  Amount?: string;
  Type?: string; // e.g. Purchase, Sale
  [key: string]: unknown;
}

export interface QuiverInsiderRow {
  Ticker?: string;
  Name?: string;
  Date?: string;
  Transaction?: string;
  Amount?: number;
  [key: string]: unknown;
}

export interface QuiverOffExchangeRow {
  Ticker?: string;
  Date?: string;
  ShortVolume?: number;
  TotalVolume?: number;
  [key: string]: unknown;
}

export class QuiverQuantProvider {
  constructor(private token: string) {}

  private async fetch<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = params
      ? `${QUIVER_BASE}${path}?${new URLSearchParams(params)}`
      : `${QUIVER_BASE}${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Token ${this.token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) throw new Error(`Quiver API ${res.status}`);
      return [] as unknown as T;
    }
    return (await res.json()) as T;
  }

  async getWallStreetBets(): Promise<QuiverWSBRow[]> {
    try {
      const data = await this.fetch<QuiverWSBRow[] | QuiverWSBRow>("/live/wallstreetbets");
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getCongressTrading(): Promise<QuiverCongressRow[]> {
    try {
      const data = await this.fetch<QuiverCongressRow[] | QuiverCongressRow>("/live/congresstrading");
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getInsiders(ticker?: string): Promise<QuiverInsiderRow[]> {
    try {
      const path = ticker ? `/live/insiders?ticker=${encodeURIComponent(ticker)}` : "/live/insiders";
      const data = await this.fetch<QuiverInsiderRow[] | QuiverInsiderRow>(path);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getOffExchange(): Promise<QuiverOffExchangeRow[]> {
    try {
      const data = await this.fetch<QuiverOffExchangeRow[] | QuiverOffExchangeRow>("/live/offexchange");
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
}

export function createQuiverQuantProvider(token: string): QuiverQuantProvider {
  return new QuiverQuantProvider(token);
}
