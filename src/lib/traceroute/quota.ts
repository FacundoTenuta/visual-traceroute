const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_REMOTE_TRACES_PER_HOUR = 10;

export type QuotaResult = { ok: true; remaining: number } | { ok: false; retryAfterS: number };

/**
 * Sliding one-hour budget per key (a visitor). Over the limit, nothing is
 * spent and the caller learns when the oldest use leaves the window. Lives in
 * process memory, so on serverless hosts each instance counts on its own.
 */
export class HourlyQuota {
  private readonly uses = new Map<string, number[]>();
  private readonly limit: number;
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor({ limit, now = Date.now, maxKeys = 10_000 }: { limit: number; now?: () => number; maxKeys?: number }) {
    this.limit = limit;
    this.now = now;
    this.maxKeys = maxKeys;
  }

  get size(): number {
    return this.uses.size;
  }

  take(key: string): QuotaResult {
    const t = this.now();
    const recent = (this.uses.get(key) ?? []).filter((at) => at > t - HOUR_MS);
    if (recent.length >= this.limit) {
      this.uses.set(key, recent);
      return { ok: false, retryAfterS: Math.ceil((recent[0] + HOUR_MS - t) / 1000) };
    }
    recent.push(t);
    // Re-insert so the Map's order is least recently used first, then evict.
    this.uses.delete(key);
    this.uses.set(key, recent);
    while (this.uses.size > this.maxKeys) {
      const oldest = this.uses.keys().next().value;
      if (oldest === undefined) break;
      this.uses.delete(oldest);
    }
    return { ok: true, remaining: this.limit - recent.length };
  }
}

/** REMOTE_TRACES_PER_HOUR as a positive whole number, else the default (10). */
export function remoteTracesPerHour(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_REMOTE_TRACES_PER_HOUR;
}
