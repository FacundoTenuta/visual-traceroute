import { describe, expect, it } from "vitest";
import { TraceLimiter } from "./limiter";

describe("TraceLimiter", () => {
  it("allows up to the per-client limit for one client", () => {
    const limiter = new TraceLimiter({ maxTotal: 5, maxPerClient: 2 });
    expect(limiter.acquire("a").ok).toBe(true);
    expect(limiter.acquire("a").ok).toBe(true);
    expect(limiter.acquire("a")).toEqual({
      ok: false,
      error: "You already have 2 traces running. Stop one or wait for it to finish.",
    });
    expect(limiter.acquire("b").ok).toBe(true);
  });

  it("enforces the global limit across clients", () => {
    const limiter = new TraceLimiter({ maxTotal: 2, maxPerClient: 2 });
    expect(limiter.acquire("a").ok).toBe(true);
    expect(limiter.acquire("b").ok).toBe(true);
    expect(limiter.acquire("c")).toEqual({ ok: false, error: "Too many traces running. Try again in a moment." });
  });

  it("frees slots on release, and releasing twice is harmless", () => {
    const limiter = new TraceLimiter({ maxTotal: 1, maxPerClient: 1 });
    const slot = limiter.acquire("a");
    if (!slot.ok) throw new Error("expected a slot");
    slot.release();
    slot.release();
    expect(limiter.acquire("b").ok).toBe(true);
    expect(limiter.acquire("c").ok).toBe(false);
  });

  it("applies only the global cap to callers without a client id", () => {
    const limiter = new TraceLimiter({ maxTotal: 3, maxPerClient: 1 });
    expect(limiter.acquire(null).ok).toBe(true);
    expect(limiter.acquire(null).ok).toBe(true);
    expect(limiter.acquire(null).ok).toBe(true);
    expect(limiter.acquire(null)).toEqual({ ok: false, error: "Too many traces running. Try again in a moment." });
  });
});
