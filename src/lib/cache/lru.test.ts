import { describe, expect, it } from "vitest";
import { TtlLru } from "./lru";

describe("TtlLru", () => {
  it("returns stored values until they expire", () => {
    let now = 0;
    const cache = new TtlLru<string>({ maxEntries: 10, now: () => now });
    cache.set("a", "1", 1000);
    expect(cache.get("a")).toBe("1");
    now = 999;
    expect(cache.get("a")).toBe("1");
    now = 1000;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("evicts the least recently used entry when full", () => {
    const cache = new TtlLru<number>({ maxEntries: 2, now: () => 0 });
    cache.set("a", 1, 1000);
    cache.set("b", 2, 1000);
    cache.get("a");
    cache.set("c", 3, 1000);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("can store null as a real value", () => {
    const cache = new TtlLru<string | null>({ maxEntries: 2, now: () => 0 });
    cache.set("x", null, 1000);
    expect(cache.has("x")).toBe(true);
    expect(cache.get("x")).toBeNull();
  });
});
