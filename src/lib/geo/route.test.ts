import { describe, expect, it } from "vitest";
import type { EnrichedHop, GeoInfo } from "@/lib/traceroute/types";
import { ARC_BASE_M, arcAltitudeM, buildRoute, greatCircle, haversineKm, latencyBand, liftTrack, sliceLine, zoomForSpan } from "./route";

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

describe("3D arcs", () => {
  it("is flat for hops inside one city and grows with distance", () => {
    expect(arcAltitudeM(5)).toBe(0);
    expect(arcAltitudeM(500)).toBe(50_000);
    expect(arcAltitudeM(5000)).toBeGreaterThan(arcAltitudeM(500));
    expect(arcAltitudeM(50_000)).toBe(450_000);
  });

  it("lifts a track so it leaves and lands on the ground, peaking mid-way", () => {
    const track = greatCircle([-3.7, 40.4], [-74, 40.7], 32);
    const path = liftTrack(track, 5770);
    expect(path).toHaveLength(track.length);
    expect(path[0]).toEqual([...track[0], ARC_BASE_M]);
    expect(path.at(-1)![2]).toBeCloseTo(ARC_BASE_M);
    const mid = path[16];
    expect(mid[0]).toBe(track[16][0]);
    expect(mid[2]).toBeCloseTo(ARC_BASE_M + arcAltitudeM(5770));
    expect(path[8][2]).toBeLessThan(mid[2]);
  });

  it("chooses a closer camera for short segments", () => {
    expect(zoomForSpan(100)).toBe(5.2);
    expect(zoomForSpan(1000)).toBeCloseTo(3.2);
    expect(zoomForSpan(20_000)).toBe(1.5);
  });
});

describe("buildRoute segments", () => {
  const a = geo("81.46.66.5", 40.4, -3.7);
  const b = geo("8.8.8.8", 40.7, -74);

  it("gives each segment a stable key, its RTT range, a ground track and a 3D arc", () => {
    const route = buildRoute(null, [hop(3, a.ip, a, 12), hop(4, b.ip, b, 95)]);
    const [segment] = route.segments.features;
    expect(segment.properties).toMatchObject({ key: "hop-3>hop-4", fromRtt: 12, rtt: 95 });
    expect(segment.geometry.coordinates[0]).toEqual([-3.7, 40.4]);
    expect(route.arcs[0]).toMatchObject({ key: "hop-3>hop-4", fromRtt: 12, rtt: 95 });
    expect(route.arcs[0].path.map(([x, y]) => [x, y])).toEqual(segment.geometry.coordinates);
    expect(Math.max(...route.arcs[0].path.map((p) => p[2]))).toBeGreaterThan(0);
  });

  it("starts the gradient at the first hop's colour when leaving the origin", () => {
    const origin = geo("203.0.113.7", 41.39, 2.17);
    const route = buildRoute(origin, [hop(1, a.ip, a, 7)]);
    expect(route.arcs[0]).toMatchObject({ fromRtt: 7, rtt: 7 });
  });

  it("records the RTT of the last hop grouped at a stop", () => {
    const a2 = geo("81.46.0.205", 40.4, -3.7);
    const route = buildRoute(null, [hop(3, a.ip, a, 5), hop(4, a2.ip, a2, 9)]);
    expect(route.stops[0].rtt).toBe(9);
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

  it("drops a tip that would sit on top of the previous vertex", () => {
    expect(sliceLine(line, 0.5 + 1e-6)).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  it("interpolates extra coordinates such as altitude", () => {
    expect(sliceLine<[number, number, number]>([[0, 0, 0], [10, 0, 100]], 0.5)).toEqual([
      [0, 0, 0],
      [5, 0, 50],
    ]);
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
