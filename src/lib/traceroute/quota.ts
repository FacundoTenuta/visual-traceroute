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

  get max(): number {
    return this.limit;
  }

  /** Gives back the most recent use, e.g. when the remote service never ran the trace. */
  refund(key: string): void {
    this.uses.get(key)?.pop();
  }

  reset(): void {
    this.uses.clear();
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

/** Expands an IPv6 address into its eight hextets, or returns null if it isn't one. */
function ipv6Hextets(ip: string): string[] | null {
  if (!ip.includes(":") || !/^[0-9a-f:]+$/i.test(ip)) return null;
  const [head, tail] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((ip.includes("::") ? missing < 1 : missing !== 0) || ip.split("::").length > 2) return null;
  return [...left, ...Array(ip.includes("::") ? missing : 0).fill("0"), ...right].map((h) => String(parseInt(h || "0", 16).toString(16)));
}

/**
 * Who a quota belongs to. IPv6 clients usually control a whole /64, so the
 * prefix is the visitor; IPv4 (and IPv4-mapped IPv6) addresses stay as they are.
 */
export function quotaKey(visitor: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(visitor);
  if (mapped) return mapped[1];
  const hextets = ipv6Hextets(visitor);
  return hextets ? `${hextets.slice(0, 4).join(":")}::/64` : visitor;
}

export function quotaMessage(limit: number, retryAfterS: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterS / 60));
  const wait = minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
  return `You've used your ${limit} remote trace${limit === 1 ? "" : "s"} for this hour. Try again in ${wait}.`;
}

/** REMOTE_TRACES_PER_HOUR as a positive whole number, else the default (10). */
export function remoteTracesPerHour(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_REMOTE_TRACES_PER_HOUR;
}

/** Each visitor's share of the Globalping quota (every visitor shares one account). */
export const remoteQuota = new HourlyQuota({ limit: remoteTracesPerHour(process.env.REMOTE_TRACES_PER_HOUR) });
