interface Entry<V> {
  value: V;
  expiresAt: number;
}

/** Small least-recently-used cache whose entries also expire after a TTL. */
export class TtlLru<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor({ maxEntries, now = Date.now }: { maxEntries: number; now?: () => number }) {
    this.maxEntries = maxEntries;
    this.now = now;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.read(key) !== undefined;
  }

  get(key: string): V | undefined {
    return this.read(key)?.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  private read(key: string): Entry<V> | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-insert to mark as most recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }
}
