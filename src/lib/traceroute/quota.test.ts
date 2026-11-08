import { describe, expect, it } from "vitest";
import { HourlyQuota } from "./quota";

const HOUR = 60 * 60 * 1000;

function setup(limit = 3) {
  const clock = { now: 0 };
  return { clock, quota: new HourlyQuota({ limit, now: () => clock.now }) };
}

describe("HourlyQuota", () => {
  it("allows up to the limit within an hour and reports what is left", () => {
    const { quota } = setup(3);
    expect(quota.take("a")).toEqual({ ok: true, remaining: 2 });
    expect(quota.take("a")).toEqual({ ok: true, remaining: 1 });
    expect(quota.take("a")).toEqual({ ok: true, remaining: 0 });
    expect(quota.take("a").ok).toBe(false);
  });

  it("says how long until the oldest trace leaves the window", () => {
    const { quota, clock } = setup(2);
    quota.take("a");
    clock.now = 20 * 60 * 1000;
    quota.take("a");
    clock.now = 30 * 60 * 1000;
    expect(quota.take("a")).toEqual({ ok: false, retryAfterS: 30 * 60 });
  });

  it("uses a sliding window: a slot frees exactly one hour after it was used", () => {
    const { quota, clock } = setup(1);
    quota.take("a");
    clock.now = HOUR - 1;
    expect(quota.take("a").ok).toBe(false);
    clock.now = HOUR;
    expect(quota.take("a")).toEqual({ ok: true, remaining: 0 });
  });

  it("does not spend a slot when the visitor is over the limit", () => {
    const { quota, clock } = setup(1);
    quota.take("a");
    clock.now = 30 * 60 * 1000;
    quota.take("a");
    quota.take("a");
    clock.now = HOUR;
    expect(quota.take("a").ok).toBe(true);
  });

  it("keeps each visitor's count separate", () => {
    const { quota } = setup(1);
    expect(quota.take("a").ok).toBe(true);
    expect(quota.take("b").ok).toBe(true);
    expect(quota.take("a").ok).toBe(false);
  });

  it("forgets the oldest visitors when it tracks too many", () => {
    const clock = { now: 0 };
    const quota = new HourlyQuota({ limit: 1, now: () => clock.now, maxKeys: 2 });
    quota.take("a");
    quota.take("b");
    quota.take("c");
    expect(quota.size).toBe(2);
    expect(quota.take("a").ok).toBe(true);
  });
});

describe("remoteTracesPerHour", () => {
  it("reads REMOTE_TRACES_PER_HOUR and falls back to 10 for missing or invalid values", async () => {
    const { remoteTracesPerHour } = await import("./quota");
    expect(remoteTracesPerHour(undefined)).toBe(10);
    expect(remoteTracesPerHour("25")).toBe(25);
    expect(remoteTracesPerHour("0")).toBe(10);
    expect(remoteTracesPerHour("-3")).toBe(10);
    expect(remoteTracesPerHour("ten")).toBe(10);
    expect(remoteTracesPerHour("2.5")).toBe(10);
  });
});

describe("quota keys and refunds", () => {
  it("counts a whole IPv6 /64 as one visitor, since one client controls all of it", async () => {
    const { quotaKey } = await import("./quota");
    expect(quotaKey("2001:db8:abcd:12:1::1")).toBe(quotaKey("2001:db8:abcd:12:ffff:ffff:ffff:fffe"));
    expect(quotaKey("2001:db8:abcd:12::1")).toBe("2001:db8:abcd:12::/64");
    expect(quotaKey("2001:db8:abcd:13::1")).not.toBe(quotaKey("2001:db8:abcd:12::1"));
    expect(quotaKey("::1")).toBe("0:0:0:0::/64");
  });

  it("keeps IPv4 addresses (also IPv4-mapped ones) as they are", async () => {
    const { quotaKey } = await import("./quota");
    expect(quotaKey("198.51.100.7")).toBe("198.51.100.7");
    expect(quotaKey("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(quotaKey("local")).toBe("local");
  });

  it("gives a slot back with refund", () => {
    const { quota } = setup(1);
    quota.take("a");
    quota.refund("a");
    expect(quota.take("a").ok).toBe(true);
    quota.refund("unknown");
  });

  it("phrases the limit message in singular and plural", async () => {
    const { quotaMessage } = await import("./quota");
    expect(quotaMessage(10, 3600)).toBe("You've used your 10 remote traces for this hour. Try again in about 60 minutes.");
    expect(quotaMessage(1, 30)).toBe("You've used your 1 remote trace for this hour. Try again in about a minute.");
  });
});
