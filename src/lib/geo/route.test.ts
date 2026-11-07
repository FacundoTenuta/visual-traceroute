import { describe, expect, it } from "vitest";
import type { EnrichedHop, GeoInfo } from "@/lib/traceroute/types";
import { buildRoute, greatCircle, haversineKm, latencyBand } from "./route";

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
