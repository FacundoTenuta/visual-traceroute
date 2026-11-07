import { describe, expect, it } from "vitest";
import type { EnrichedHop, GeoInfo } from "@/lib/traceroute/types";
import { ARC_BASE_M, arcAltitudeM, bendTrack, buildRoute, greatCircle, haversineKm, latencyBand, liftTrack, sliceLine, zoomForSpan } from "./route";

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

  it("gives each segment a stable key, one RTT colour, a ground track and a 3D arc", () => {
    const route = buildRoute(null, [hop(3, a.ip, a, 12), hop(4, b.ip, b, 95)]);
    const [segment] = route.segments.features;
    expect(segment.properties).toMatchObject({ key: "hop-3>hop-4#0", rtt: 95 });
    expect(segment.properties).not.toHaveProperty("fromRtt");
    expect(segment.geometry.coordinates[0]).toEqual([-3.7, 40.4]);
    expect(route.arcs[0]).toMatchObject({ key: "hop-3>hop-4#0", rtt: 95 });
    expect(route.arcs[0].path.map(([x, y]) => [x, y])).toEqual(segment.geometry.coordinates);
    expect(Math.max(...route.arcs[0].path.map((p) => p[2]))).toBeGreaterThan(0);
  });

  it("records the RTT of the last hop grouped at a stop", () => {
    const a2 = geo("81.46.0.205", 40.4, -3.7);
    const route = buildRoute(null, [hop(3, a.ip, a, 5), hop(4, a2.ip, a2, 9)]);
    expect(route.stops[0].rtt).toBe(9);
  });
});

describe("revisited places", () => {
  const madrid = geo("81.46.66.5", 40.4, -3.7, "Madrid");
  const madridAgain = geo("81.46.0.205", 40.4, -3.7, "Madrid");
  const ny = geo("4.68.71.45", 40.7, -74, "New York");

  it("reuses one pin for a place the route comes back to", () => {
    const route = buildRoute(null, [hop(3, madrid.ip, madrid, 5), hop(4, ny.ip, ny, 90), hop(5, madridAgain.ip, madridAgain, 8)]);
    expect(route.stops.map((s) => s.label)).toEqual(["3, 5", "4"]);
    expect(route.stops[0]).toMatchObject({ hops: [3, 5], rtt: 8 });
  });

  it("colours each segment with the RTT of the hop it arrives at", () => {
    const route = buildRoute(null, [hop(3, madrid.ip, madrid, 5), hop(4, ny.ip, ny, 90), hop(5, madridAgain.ip, madridAgain, 8)]);
    expect(route.segments.features.map((f) => f.properties.rtt)).toEqual([90, 8]);
  });

  it("curves a segment that repeats the same two places so it does not overlap", () => {
    const route = buildRoute(null, [hop(3, madrid.ip, madrid, 5), hop(4, ny.ip, ny, 90), hop(5, madridAgain.ip, madridAgain, 8)]);
    const [there, back] = route.segments.features.map((f) => f.geometry.coordinates);
    expect(route.segments.features.map((f) => f.properties.key)).toEqual(["hop-3>hop-4#0", "hop-4>hop-3#1"]);
    const mid = (line: number[][]) => line[Math.floor(line.length / 2)];
    const [x1, y1] = mid(there);
    const [x2, y2] = mid(back);
    expect(Math.hypot(x1 - x2, y1 - y2)).toBeGreaterThan(3);
    expect(back[0]).toEqual([-74, 40.7]);
    expect(back.at(-1)).toEqual([-3.7, 40.4]);
  });

  it("compresses hop numbers into ranges on the pin label", () => {
    const madrid2 = geo("81.46.66.9", 40.4, -3.7, "Madrid");
    const route = buildRoute(null, [
      hop(3, madrid.ip, madrid, 5),
      hop(4, madrid2.ip, madrid2, 6),
      hop(5, ny.ip, ny, 90),
      hop(6, madridAgain.ip, madridAgain, 8),
    ]);
    expect(route.stops[0].label).toBe("3–4, 6");
  });
});

describe("repeated segments between nearby places", () => {
  it("fans segments whose ends are near the same two places, whatever the order", () => {
    const madrid = geo("81.46.66.5", 40.4, -3.7, "Madrid");
    const alcobendas = geo("81.46.66.9", 40.54, -3.64, "Alcobendas");
    const ny = geo("4.68.71.45", 40.7, -74, "New York");
    const nj = geo("4.68.71.46", 40.73, -74.17, "Newark");
    const route = buildRoute(null, [
      hop(1, madrid.ip, madrid, 5),
      hop(2, ny.ip, ny, 90),
      hop(3, alcobendas.ip, alcobendas, 6),
      hop(4, nj.ip, nj, 95),
    ]);
    const mids = route.segments.features.map((f) => f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)]);
    expect(mids).toHaveLength(3);
    for (let i = 0; i < mids.length; i++) {
      for (let j = i + 1; j < mids.length; j++) {
        expect(Math.hypot(mids[i][0] - mids[j][0], mids[i][1] - mids[j][1])).toBeGreaterThan(2);
      }
    }
  });
});

describe("repeated segments", () => {
  const madrid = geo("81.46.66.5", 40.4, -3.7, "Madrid");
  const ny = geo("4.68.71.45", 40.7, -74, "New York");
  const straightMid = greatCircle([-3.7, 40.4], [-74, 40.7], 128)[64];

  /** Route bouncing Madrid ⇄ New York `trips` times. */
  function bouncing(trips: number) {
    const hops = Array.from({ length: trips + 1 }, (_, i) =>
      i % 2 === 0 ? hop(i + 1, `10.0.0.${i}`, { ...madrid, ip: `10.0.0.${i}` }, 5) : hop(i + 1, `10.1.0.${i}`, { ...ny, ip: `10.1.0.${i}` }, 90),
    );
    return buildRoute(null, hops);
  }
  /** Signed sideways offset (lat degrees) of each segment's midpoint from the straight path. */
  const offsets = (route: ReturnType<typeof buildRoute>) =>
    route.segments.features.map((f) => {
      const line = f.geometry.coordinates;
      return line[Math.floor(line.length / 2)][1] - straightMid[1];
    });

  it("moves both segments of a round trip, one to each side, by the same amount", () => {
    const [there, back] = offsets(bouncing(2));
    expect(Math.sign(there)).toBe(-Math.sign(back));
    expect(Math.abs(there)).toBeGreaterThan(1);
    expect(Math.abs(there)).toBeCloseTo(Math.abs(back), 0);
  });

  it("keeps the middle one of three straight and spreads the others to both sides", () => {
    const [first, middle, last] = offsets(bouncing(3));
    expect(Math.abs(middle)).toBeLessThan(0.5);
    expect(Math.sign(first)).toBe(-Math.sign(last));
  });

  it("caps the total fan width however many repeats there are", () => {
    const few = offsets(bouncing(3));
    const many = offsets(bouncing(12));
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(spread(many)).toBeLessThanOrEqual(spread(few) * 1.6);
    // Centred: as much to one side as to the other.
    expect(Math.max(...many) + Math.min(...many)).toBeCloseTo(0, 0);
  });
});

describe("bendTrack", () => {
  const track = greatCircle([-3.7, 40.4], [-74, 40.7], 32);
  const toVec = ([lon, lat]: number[]) => {
    const r = Math.PI / 180;
    return [Math.cos(lat * r) * Math.cos(lon * r), Math.cos(lat * r) * Math.sin(lon * r), Math.sin(lat * r)];
  };
  const angleDeg = (a: number[], b: number[]) => {
    const [x, y] = [toVec(a), toVec(b)];
    const dot = Math.min(1, Math.max(-1, x[0] * y[0] + x[1] * y[1] + x[2] * y[2]));
    return (Math.acos(dot) * 180) / Math.PI;
  };

  it("keeps its shape over the poles: smooth steps and a bounded offset", () => {
    // Europe to Japan over the North Pole.
    const polar = greatCircle([2.17, 41.39], [139.7, 35.7], 64);
    const bent = bendTrack(polar, 0.12);
    const span = angleDeg(polar[0], polar.at(-1)!);
    for (let i = 1; i < bent.length; i++) expect(angleDeg(bent[i - 1], bent[i])).toBeLessThan((span / 64) * 2);
    const mid = angleDeg(bent[32], polar[32]);
    expect(mid).toBeCloseTo(0.12 * span, 0);
    for (let i = 0; i < bent.length; i++) expect(angleDeg(bent[i], polar[i])).toBeLessThanOrEqual(0.12 * span + 0.01);
  });

  it("keeps the endpoints and leaves the track alone when the amount is zero", () => {
    expect(bendTrack(track, 0)).toEqual(track);
    const bent = bendTrack(track, 0.15);
    expect(bent[0]).toEqual(track[0]);
    expect(bent.at(-1)).toEqual(track.at(-1));
  });

  it("bows the middle sideways, to opposite sides for opposite signs", () => {
    const left = bendTrack(track, 0.15)[16];
    const right = bendTrack(track, -0.15)[16];
    const base = track[16];
    expect(Math.sign(left[1] - base[1])).toBe(-Math.sign(right[1] - base[1]));
    expect(Math.hypot(left[0] - base[0], left[1] - base[1])).toBeGreaterThan(3);
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
