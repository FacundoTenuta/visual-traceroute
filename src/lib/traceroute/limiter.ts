export type Slot = { ok: true; release(): void } | { ok: false; error: string };

/**
 * Caps concurrent traces globally and per client, so one caller cannot hold
 * every slot. Each trace spawns a process that may run for minutes.
 */
export class TraceLimiter {
  private readonly perClient = new Map<string, number>();
  private total = 0;
  private readonly maxTotal: number;
  private readonly maxPerClient: number;

  constructor({ maxTotal, maxPerClient }: { maxTotal: number; maxPerClient: number }) {
    this.maxTotal = maxTotal;
    this.maxPerClient = maxPerClient;
  }

  acquire(client: string): Slot {
    const mine = this.perClient.get(client) ?? 0;
    if (mine >= this.maxPerClient) {
      return {
        ok: false,
        error: `You already have ${this.maxPerClient} traces running. Stop one or wait for it to finish.`,
      };
    }
    if (this.total >= this.maxTotal) {
      return { ok: false, error: "Too many traces running. Try again in a moment." };
    }

    this.total++;
    this.perClient.set(client, mine + 1);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.total--;
        const left = (this.perClient.get(client) ?? 1) - 1;
        if (left <= 0) this.perClient.delete(client);
        else this.perClient.set(client, left);
      },
    };
  }
}
