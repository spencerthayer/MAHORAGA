/**
 * Per-cycle rate limiter for data gatherers.
 * Tracks call counts per provider within a single run; reset each gather cycle.
 * Use to stay under API budgets (e.g. Finnhub 60/min, FMP 250/day).
 */

export const RATE_LIMIT_BUDGETS: Record<string, number> = {
  finnhub: 30, // 60/min → budget 30 per 30s cycle
  fmp: 10, // 250/day → ~10 per cycle if running every 5 min
  quiver: 20,
  alpaca: 50,
};

export class RateLimiter {
  private counts: Record<string, number> = {};
  private budgets: Record<string, number>;

  constructor(budgets: Record<string, number> = RATE_LIMIT_BUDGETS) {
    this.budgets = { ...budgets };
  }

  record(provider: string): void {
    this.counts[provider] = (this.counts[provider] ?? 0) + 1;
  }

  getCount(provider: string): number {
    return this.counts[provider] ?? 0;
  }

  getRemaining(provider: string): number {
    const budget = this.budgets[provider] ?? 999;
    return Math.max(0, budget - (this.counts[provider] ?? 0));
  }

  /** Returns true if the provider has remaining budget and records the call. */
  consume(provider: string): boolean {
    if (this.getRemaining(provider) <= 0) return false;
    this.record(provider);
    return true;
  }

  reset(): void {
    this.counts = {};
  }
}
