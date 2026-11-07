import { describe, expect, it, vi } from "vitest";
import type { GeoInfo, TraceEvent } from "./types";
import { runTraceSession, type LineSource, type SessionDeps } from "./session";

const HEADER = "traceroute to one.one.one.one (1.1.1.1), 30 hops max, 40 byte packets";

function source(stdout: string[], stderr: string[], exitCode: number): LineSource {
  async function* lines() {
    for (const line of stderr) yield { stream: "stderr" as const, line };
    for (const line of stdout) yield { stream: "stdout" as const, line };
  }
  return { lines: lines(), exit: Promise.resolve(exitCode) };
}

const geoFor = (ip: string): GeoInfo => ({
  ip,
  lat: 40,
  lon: -3,
  city: "Madrid",
  region: "Madrid",
  country: "Spain",
  countryCode: "ES",
  timezone: "Europe/Madrid",
  isp: "Example ISP",
  org: null,
  asn: "AS3352",
  asName: "TELEFONICA",
});

function deps(overrides: Partial<SessionDeps> & { source: LineSource }): SessionDeps {
  let t = 1000;
  return {
    geolocate: vi.fn(async (ip: string) => geoFor(ip)),
    reverseDns: vi.fn(async (ip: string) => `host-${ip.replaceAll(".", "-")}.example`),
    origin: vi.fn(async () => geoFor("203.0.113.7")),
    now: () => (t += 250),
    ...overrides,
  };
}

async function collect(target: string, d: SessionDeps) {
  const events: TraceEvent[] = [];
  await runTraceSession(target, d, (e) => events.push(e));
  return events;
}

const lastHop = (events: TraceEvent[], n: number) =>
  events.filter((e) => e.type === "hop" && e.hop.hop === n).at(-1) as Extract<
    TraceEvent,
    { type: "hop" }
  >;

describe("runTraceSession", () => {
  it("streams start, hops and done, finishing with fully enriched hops", async () => {
    const d = deps({
      source: source([" 1  10.0.0.1  1.0 ms  2.0 ms  3.0 ms", " 2  1.1.1.1  9.0 ms  8.0 ms  7.0 ms"], [HEADER], 0),
    });
    const events = await collect("one.one.one.one", d);

    expect(events[0]).toEqual({ type: "start", target: "one.one.one.one", ip: "1.1.1.1", maxHops: 30 });
    expect(events.at(-1)).toEqual({ type: "done", elapsedMs: 250, hops: 2, reached: true });

    expect(lastHop(events, 1).hop.addresses).toEqual([
      { ip: "10.0.0.1", isPrivate: true, hostname: null, geo: null, pending: false },
    ]);
    expect(lastHop(events, 2).hop.addresses).toEqual([
      { ip: "1.1.1.1", isPrivate: false, hostname: "host-1-1-1-1.example", geo: geoFor("1.1.1.1"), pending: false },
    ]);
    expect(lastHop(events, 2).hop.rtt).toEqual({ min: 7, avg: 8, max: 9 });
  });

  it("emits a hop as pending before its enrichment resolves", async () => {
    const d = deps({ source: source([" 1  8.8.8.8  5.0 ms"], [HEADER], 0) });
    const events = await collect("x", d);
    const hopEvents = events.filter((e) => e.type === "hop");
    expect(hopEvents[0].type === "hop" && hopEvents[0].hop.addresses[0].pending).toBe(true);
  });

  it("never geolocates or reverse-resolves private addresses", async () => {
    const d = deps({ source: source([" 1  192.168.1.1  1.0 ms"], [HEADER], 0) });
    const events = await collect("x", d);
    expect(d.geolocate).not.toHaveBeenCalledWith("192.168.1.1");
    expect(d.reverseDns).not.toHaveBeenCalledWith("192.168.1.1");
    expect(lastHop(events, 1).hop.addresses[0]).toEqual({
      ip: "192.168.1.1",
      isPrivate: true,
      hostname: null,
      geo: null,
      pending: false,
    });
  });

  it("looks up every address only once", async () => {
    const d = deps({
      source: source(
        [" 1  8.8.8.8  1.0 ms", "    9.9.9.9  2.0 ms", " 2  8.8.8.8  3.0 ms  4.0 ms"],
        [HEADER],
        0,
      ),
    });
    await collect("x", d);
    // 8.8.8.8 and 9.9.9.9 once each, plus the destination 1.1.1.1.
    expect(vi.mocked(d.geolocate).mock.calls.map(([ip]) => ip).sort()).toEqual(["1.1.1.1", "8.8.8.8", "9.9.9.9"]);
  });

  it("reports origin and destination locations", async () => {
    const d = deps({ source: source([" 1  1.1.1.1  1.0 ms"], [HEADER], 0) });
    const events = await collect("x", d);
    expect(events).toContainEqual({ type: "origin", geo: geoFor("203.0.113.7") });
    expect(events).toContainEqual({ type: "destination", geo: geoFor("1.1.1.1"), hostname: "host-1-1-1-1.example" });
  });

  it("marks the route as not reached when the last hop is not the destination", async () => {
    const d = deps({ source: source([" 1  8.8.8.8  1.0 ms", " 2  * * *"], [HEADER], 0) });
    const events = await collect("x", d);
    expect(events.at(-1)).toMatchObject({ type: "done", hops: 2, reached: false });
  });

  it("turns traceroute failures into a readable error", async () => {
    const d = deps({ source: source([], ["traceroute: unknown host doesnotexist.invalid"], 1) });
    const events = await collect("doesnotexist.invalid", d);
    expect(events).toEqual([{ type: "error", message: "Unknown host doesnotexist.invalid" }]);
  });

  it("keeps streaming when lookups fail", async () => {
    const d = deps({
      source: source([" 1  8.8.8.8  1.0 ms"], [HEADER], 0),
      geolocate: vi.fn(async () => {
        throw new Error("rate limited");
      }),
      reverseDns: vi.fn(async () => {
        throw new Error("ENOTFOUND");
      }),
    });
    const events = await collect("x", d);
    expect(lastHop(events, 1).hop.addresses[0]).toEqual({
      ip: "8.8.8.8",
      isPrivate: false,
      hostname: null,
      geo: null,
      pending: false,
    });
    expect(events.at(-1)?.type).toBe("done");
  });
});
