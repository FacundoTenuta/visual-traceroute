import { describe, expect, it } from "vitest";
import type { EnrichedHop, GeoInfo } from "@/lib/traceroute/types";
import { buildRoute, greatCircle, haversineKm, latencyBand, liftedArc, sliceLine } from "./route";

const geo = (ip: string, lat: number, lon: number, city = "X"): GeoInfo => ({
  ip,
  lat,
  lon,
  city,
  region: null,
  country: "Somewhere",
  countryCode: "ES",
  timezone: null,
  isp: null,
  org: null,
  asn: null,
  asName: null,
});

const hop = (n: number, ip: string | null, g: GeoInfo | null, avg = 10): EnrichedHop => ({
  hop: n,
  probes: [{ ip, rtt: ip ? avg : null }],
  ips: ip ? [ip] : [],
  primaryIp: ip,
  rtt: ip ? { min: avg, avg, max: avg } : null,
  loss: ip ? 0 : 1,
  annotations: [],
  addresses: ip ? [{ ip, isPrivate: !g, hostname: null, geo: g, pending: false }] : [],
});

describe("haversineKm", () => {
  it("measures Madrid to New York at about 5,770 km", () => {
    expect(haversineKm([-3.7, 40.4], [-74.0, 40.7])).toBeGreaterThan(5700);
    expect(haversineKm([-3.7, 40.4], [-74.0, 40.7])).toBeLessThan(5850);
  });

  it("is zero for the same point", () => {
    expect(haversineKm([10, 10], [10, 10])).toBe(0);
  });
});

describe("greatCircle", () => {
  it("starts and ends at the given points", () => {
    const line = greatCircle([-3.7, 40.4], [-74, 40.7], 16);
    expect(line).toHaveLength(17);
    expect(line[0][0]).toBeCloseTo(-3.7);
    expect(line[0][1]).toBeCloseTo(40.4);
    expect(line.at(-1)![0]).toBeCloseTo(-74);
    expect(line.at(-1)![1]).toBeCloseTo(40.7);
  });

  it("bows toward the pole between two points at the same latitude", () => {
    const line = greatCircle([-3.7, 40.4], [-74, 40.7], 16);
    expect(line[8][1]).toBeGreaterThan(45);
  });

  it("keeps longitudes continuous across the antimeridian", () => {
    const line = greatCircle([170, 0], [-170, 0], 8);
    for (let i = 1; i < line.length; i++) {
      expect(Math.abs(line[i][0] - line[i - 1][0])).toBeLessThan(10);
    }
    expect(line.at(-1)![0]).toBeCloseTo(190);
  });

  it("returns the single point for identical endpoints", () => {
    expect(greatCircle([5, 5], [5, 5], 8)).toEqual([[5, 5]]);
  });
});

describe("latencyBand", () => {
  it.each([
    [null, "unknown"],
    [4, "fast"],
    [49.9, "fast"],
    [50, "medium"],
    [149, "medium"],
    [150, "slow"],
    [299, "slow"],
    [300, "critical"],
  ])("classifies %s ms as %s", (ms, band) => {
    expect(latencyBand(ms)).toBe(band);
  });
});

describe("buildRoute", () => {
  const origin = geo("203.0.113.7", 41.39, 2.17, "Barcelona");
  const madrid = geo("81.46.66.5", 40.4, -3.7, "Madrid");
  const madrid2 = geo("81.46.0.205", 40.4, -3.7, "Madrid");
  const ny = geo("8.8.8.8", 40.7, -74, "New York");

  it("connects origin and geolocated hops in order, skipping hops without location", () => {
    const route = buildRoute(origin, [hop(1, "10.0.0.1", null), hop(2, null, null), hop(3, madrid.ip, madrid), hop(4, ny.ip, ny, 90)]);
    expect(route.stops.map((s) => s.label)).toEqual(["Origin", "3", "4"]);
    expect(route.line.geometry.coordinates[0]).toEqual([2.17, 41.39]);
    expect(route.line.geometry.coordinates.at(-1)![0]).toBeCloseTo(-74);
  });

  it("groups consecutive hops at the same location into one stop", () => {
    const route = buildRoute(null, [hop(3, madrid.ip, madrid, 5), hop(4, madrid2.ip, madrid2, 6), hop(5, ny.ip, ny, 90)]);
    expect(route.stops.map((s) => s.label)).toEqual(["3–4", "5"]);
    expect(route.stops[0].hops).toEqual([3, 4]);
    expect(route.stops[1].band).toBe("medium");
  });

  it("sums great-circle distance along the route", () => {
    const route = buildRoute(origin, [hop(1, madrid.ip, madrid), hop(2, ny.ip, ny)]);
    const expected = haversineKm([2.17, 41.39], [-3.7, 40.4]) + haversineKm([-3.7, 40.4], [-74, 40.7]);
    expect(route.distanceKm).toBeCloseTo(expected, 5);
  });

  it("returns empty geometry when nothing is located yet", () => {
    const route = buildRoute(null, [hop(1, "10.0.0.1", null)]);
    expect(route.stops).toEqual([]);
    expect(route.line.geometry.coordinates).toEqual([]);
    expect(route.bounds).toBeNull();
    expect(route.distanceKm).toBe(0);
  });

  it("computes bounds covering every stop", () => {
    const route = buildRoute(origin, [hop(1, ny.ip, ny)]);
    expect(route.bounds).toEqual([
      [-74, 40.7],
      [2.17, 41.39],
    ]);
  });
});

describe("liftedArc", () => {
  const ground = greatCircle([-3.7, 40.4], [-74, 40.7], 32);

  it("keeps both endpoints on the ground", () => {
    const arc = liftedArc(ground);
    expect(arc).toHaveLength(ground.length);
    expect(arc[0]).toEqual(ground[0]);
    expect(arc.at(-1)).toEqual(ground.at(-1));
  });

  it("rises most at the middle of the segment", () => {
    const arc = liftedArc(ground);
    const lift = arc.map((p, i) => Math.hypot(p[0] - ground[i][0], p[1] - ground[i][1]));
    const mid = Math.floor(lift.length / 2);
    expect(lift[mid]).toBeGreaterThan(1);
    expect(lift[mid]).toBeGreaterThan(lift[4]);
    expect(lift[4]).toBeGreaterThan(lift[1]);
  });

  it("lifts longer segments higher", () => {
    const short = greatCircle([-3.7, 40.4], [2.17, 41.39], 32);
    const liftAt = (g: ReturnType<typeof greatCircle>) => {
      const arc = liftedArc(g);
      const m = Math.floor(g.length / 2);
      return Math.hypot(arc[m][0] - g[m][0], arc[m][1] - g[m][1]);
    };
    expect(liftAt(ground)).toBeGreaterThan(liftAt(short));
  });

  it("leaves tiny hops flat", () => {
    const tiny = greatCircle([-3.7, 40.4], [-3.69, 40.41], 8);
    expect(liftedArc(tiny)).toEqual(tiny);
  });
});

describe("buildRoute segments", () => {
  const a = geo("81.46.66.5", 40.4, -3.7);
  const b = geo("8.8.8.8", 40.7, -74);

  it("gives each segment a stable key, a lifted arc and its ground track", () => {
    const route = buildRoute(null, [hop(3, a.ip, a), hop(4, b.ip, b)]);
    const [segment] = route.segments.features;
    expect(segment.properties.key).toBe("hop-3>hop-4");
    expect(route.ground.features[0].properties.key).toBe("hop-3>hop-4");
    expect(segment.geometry.coordinates[0]).toEqual([-3.7, 40.4]);
    expect(segment.geometry.coordinates).not.toEqual(route.ground.features[0].geometry.coordinates);
  });
});

describe("sliceLine", () => {
  const line: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
  ];

  it("returns the start point at 0 and the whole line at 1", () => {
    expect(sliceLine(line, 0)).toEqual([[0, 0]]);
    expect(sliceLine(line, 1)).toEqual(line);
  });

  it("cuts by length, interpolating the tip", () => {
    expect(sliceLine(line, 0.25)).toEqual([
      [0, 0],
      [5, 0],
    ]);
    expect(sliceLine(line, 0.75)).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
    ]);
  });
});
