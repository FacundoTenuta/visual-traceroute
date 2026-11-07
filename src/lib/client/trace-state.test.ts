import { describe, expect, it } from "vitest";
import type { EnrichedHop, GeoInfo } from "@/lib/traceroute/types";
import { initialTraceState, selectHops, traceReducer } from "./trace-state";

const hop = (n: number, avg: number): EnrichedHop => ({
  hop: n,
  probes: [],
  ips: [],
  primaryIp: null,
  rtt: { min: avg, avg, max: avg },
  loss: 0,
  annotations: [],
  addresses: [],
});

const geo = { ip: "1.1.1.1", lat: 1, lon: 2 } as GeoInfo;

describe("traceReducer", () => {
  it("resets everything when a new trace begins", () => {
    const dirty = traceReducer(initialTraceState, { type: "event", event: { type: "hop", hop: hop(1, 5) } });
    const next = traceReducer(dirty, { type: "begin", target: "example.com" });
    expect(next).toEqual({ ...initialTraceState, status: "running", target: "example.com" });
  });

  it("records the resolved destination, origin and hops", () => {
    let s = traceReducer(initialTraceState, { type: "begin", target: "x" });
    s = traceReducer(s, { type: "event", event: { type: "start", target: "x", ip: "1.1.1.1", maxHops: 30 } });
    s = traceReducer(s, { type: "event", event: { type: "origin", geo } });
    s = traceReducer(s, { type: "event", event: { type: "destination", geo, hostname: "one" } });
    s = traceReducer(s, { type: "event", event: { type: "hop", hop: hop(2, 9) } });
    s = traceReducer(s, { type: "event", event: { type: "hop", hop: hop(1, 4) } });
    expect(s.resolvedIp).toBe("1.1.1.1");
    expect(s.maxHops).toBe(30);
    expect(s.origin).toBe(geo);
    expect(s.destination).toEqual({ geo, hostname: "one" });
    expect(selectHops(s).map((h) => h.hop)).toEqual([1, 2]);
  });

  it("upserts hop updates by hop number", () => {
    let s = traceReducer(initialTraceState, { type: "event", event: { type: "hop", hop: hop(1, 4) } });
    s = traceReducer(s, { type: "event", event: { type: "hop", hop: hop(1, 7) } });
    expect(selectHops(s)).toHaveLength(1);
    expect(selectHops(s)[0].rtt?.avg).toBe(7);
  });

  it("finishes with done or error", () => {
    const done = traceReducer(initialTraceState, {
      type: "event",
      event: { type: "done", elapsedMs: 1200, hops: 9, reached: true },
    });
    expect(done).toMatchObject({ status: "done", elapsedMs: 1200, reached: true });
    const failed = traceReducer(initialTraceState, { type: "fail", message: "Unknown host x" });
    expect(failed).toMatchObject({ status: "error", error: "Unknown host x" });
  });

  it("returns to idle when cancelled, keeping the hops found so far", () => {
    let s = traceReducer(initialTraceState, { type: "begin", target: "x" });
    s = traceReducer(s, { type: "event", event: { type: "hop", hop: hop(1, 4) } });
    s = traceReducer(s, { type: "cancel" });
    expect(s.status).toBe("cancelled");
    expect(selectHops(s)).toHaveLength(1);
  });
});
