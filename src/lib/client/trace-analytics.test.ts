import { describe, expect, it } from "vitest";
import type { ProbeLocation } from "@/lib/globalping/catalog";
import { initialTraceState, type TraceState } from "./trace-state";
import type { EnrichedHop, GeoInfo } from "@/lib/traceroute/types";
import { originParams, traceCompleteParams, traceErrorReason, traceStartParams } from "./trace-analytics";

const tokyo: ProbeLocation = {
  id: "jp-tokyo",
  city: "Tokyo",
  country: "JP",
  continent: "AS",
  lat: 35.7,
  lon: 139.7,
  probes: 12,
  networks: [{ asn: 2516, network: "KDDI", probes: 5 }],
};

const geo = (ip: string, countryCode: string | null, city: string | null = null) =>
  ({ ip, lat: 0, lon: 0, city, countryCode }) as GeoInfo;

const hop = (n: number, ...addresses: Array<GeoInfo | null>): EnrichedHop => ({
  hop: n,
  probes: [],
  ips: [],
  primaryIp: null,
  rtt: null,
  loss: 0,
  annotations: [],
  addresses: addresses.map((g, i) => ({ ip: `10.0.0.${n}${i}`, isPrivate: false, hostname: null, geo: g, pending: false })),
});

describe("originParams", () => {
  it("describes a local origin without a city", () => {
    expect(originParams({ kind: "local" }, [tokyo])).toEqual({ origin_type: "local" });
  });

  it("describes a remote origin by its probe city, country and network", () => {
    expect(originParams({ kind: "remote", locationId: "jp-tokyo", asn: 2516 }, [tokyo])).toEqual({
      origin_type: "remote",
      origin_city: "Tokyo",
      origin_country: "JP",
      asn: 2516,
    });
    expect(originParams({ kind: "remote", locationId: "jp-tokyo" }, [tokyo])).toEqual({
      origin_type: "remote",
      origin_city: "Tokyo",
      origin_country: "JP",
    });
  });

  it("omits the place when the location list does not know the id", () => {
    expect(originParams({ kind: "remote", locationId: "zz-nowhere" }, [tokyo])).toEqual({ origin_type: "remote" });
  });
});

describe("traceStartParams", () => {
  it("sends a typed hostname, normalized like the server does", () => {
    expect(traceStartParams(" https://GitHub.com/login ", { kind: "local" }, [])).toEqual({
      origin_type: "local",
      target_type: "hostname",
      target_host: "github.com",
    });
  });

  it("reports an IPv4 target only as its type, never the address", () => {
    const params = traceStartParams("8.8.4.4", { kind: "remote", locationId: "jp-tokyo" }, [tokyo]);
    expect(params).toEqual({ origin_type: "remote", origin_city: "Tokyo", origin_country: "JP", target_type: "ip" });
    expect(JSON.stringify(params)).not.toContain("8.8.4.4");
  });

  it("reports an IPv6 literal as an ip without the address", () => {
    const params = traceStartParams("2001:db8::1", { kind: "local" }, []);
    expect(params).toEqual({ origin_type: "local", target_type: "ip" });
    expect(JSON.stringify(params)).not.toContain("2001");
  });

  it("never sends free text that is not a hostname", () => {
    const params = traceStartParams("my email is me@example.com", { kind: "local" }, []);
    expect(params).toEqual({ origin_type: "local", target_type: "invalid" });
    expect(JSON.stringify(params)).not.toContain("example");
  });
});

describe("traceCompleteParams", () => {
  const done = (patch: Partial<TraceState>): TraceState => ({
    ...initialTraceState,
    status: "done",
    target: "example.com",
    resolvedIp: "93.184.216.34",
    elapsedMs: 4321,
    reached: true,
    ...patch,
  });

  it("totals hops, countries and rounded distance like the panel", () => {
    const hops = [hop(1, geo("1.1.1.1", "JP")), hop(2, geo("2.2.2.2", "US"), geo("3.3.3.3", "JP")), hop(3, null)];
    const params = traceCompleteParams(done({}), hops, 9876.6, { origin_type: "remote", origin_city: "Tokyo" });
    expect(params).toEqual({
      origin_type: "remote",
      origin_city: "Tokyo",
      hops: 3,
      reached: true,
      distance_km: 9877,
      countries: 2,
      duration_ms: 4321,
    });
    expect(JSON.stringify(params)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it("takes a local trace's city from the origin the stream reported", () => {
    const params = traceCompleteParams(done({ origin: geo("5.5.5.5", "AR", "Buenos Aires"), reached: false }), [], 0, {
      origin_type: "local",
    });
    expect(params).toEqual({
      origin_type: "local",
      origin_city: "Buenos Aires",
      hops: 0,
      reached: false,
      distance_km: 0,
      countries: 0,
      duration_ms: 4321,
    });
  });
});

describe("traceErrorReason", () => {
  it("names each refusal of /api/trace", () => {
    expect(traceErrorReason(400, false)).toBe("validation");
    expect(traceErrorReason(429, false)).toBe("rate_limit");
    expect(traceErrorReason(429, true)).toBe("quota");
    expect(traceErrorReason(503, false)).toBe("unavailable");
    expect(traceErrorReason(500, false)).toBe("http");
  });
});
