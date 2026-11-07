import type { EnrichedHop, GeoInfo } from "@/lib/traceroute/types";

export type LngLat = [number, number];
export type LatencyBand = "fast" | "medium" | "slow" | "critical" | "unknown";

export interface RouteStop {
  id: string;
  kind: "origin" | "hop";
  /** Hop numbers grouped at this location (empty for the origin). */
  hops: number[];
  label: string;
  coord: LngLat;
  band: LatencyBand;
  city: string | null;
  countryCode: string | null;
}

export interface SegmentProps {
  band: LatencyBand;
  /** Stable id (`from>to`) so the map animates each segment only once. */
  key: string;
}

export interface RouteGeometry {
  stops: RouteStop[];
  line: GeoJSON.Feature<GeoJSON.LineString>;
  /** Lifted "jump" arcs, one per pair of consecutive stops. */
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, SegmentProps>;
  /** The same segments flat on the surface, drawn as a faint shadow. */
  ground: GeoJSON.FeatureCollection<GeoJSON.LineString, SegmentProps>;
  bounds: [LngLat, LngLat] | null;
  distanceKm: number;
}

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversineKm([lon1, lat1]: LngLat, [lon2, lat2]: LngLat): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const toVector = ([lon, lat]: LngLat) => [
  Math.cos(rad(lat)) * Math.cos(rad(lon)),
  Math.cos(rad(lat)) * Math.sin(rad(lon)),
  Math.sin(rad(lat)),
];

/**
 * Points along the shortest path on the sphere from `a` to `b`. Longitudes are
 * unwrapped relative to `a`, so the line never jumps across the antimeridian.
 */
export function greatCircle(a: LngLat, b: LngLat, steps: number): LngLat[] {
  const va = toVector(a);
  const vb = toVector(b);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-9) return [a];

  const points: LngLat[] = [a];
  let prevLon = a[0];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const s1 = Math.sin((1 - t) * omega) / Math.sin(omega);
    const s2 = Math.sin(t * omega) / Math.sin(omega);
    const [x, y, z] = [0, 1, 2].map((k) => s1 * va[k] + s2 * vb[k]);
    // Use the exact endpoint to avoid floating-point drift at the stop itself.
    let lon = i === steps ? b[0] : deg(Math.atan2(y, x));
    const lat = i === steps ? b[1] : deg(Math.atan2(z, Math.hypot(x, y)));
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    prevLon = lon;
    points.push([lon, lat]);
  }
  return points;
}

const planarLength = (a: LngLat, b: LngLat) => {
  const cos = Math.cos(rad((a[1] + b[1]) / 2));
  return Math.hypot((b[0] - a[0]) * cos, b[1] - a[1]);
};

const MIN_LIFT_LENGTH_DEG = 0.5;
const MAX_LIFT_DEG = 14;
const LIFT_FACTOR = 0.16;

/**
 * Bows a ground track upward (poleward on screen) like a ballistic jump: the
 * endpoints stay put and the offset peaks mid-way, growing with the segment
 * length. Tiny hops inside one city stay flat.
 */
export function liftedArc(ground: LngLat[]): LngLat[] {
  if (ground.length < 3) return ground.map((p) => [...p] as LngLat);
  const cumulative = [0];
  for (let i = 1; i < ground.length; i++) cumulative.push(cumulative[i - 1] + planarLength(ground[i - 1], ground[i]));
  const total = cumulative.at(-1)!;
  if (total < MIN_LIFT_LENGTH_DEG) return ground.map((p) => [...p] as LngLat);

  const height = Math.min(MAX_LIFT_DEG, total * LIFT_FACTOR);
  const first = ground[0];
  const last = ground.at(-1)!;
  // Chord normal decides the side once, so the whole arc bows the same way.
  const chord: LngLat = [(last[0] - first[0]) * Math.cos(rad((first[1] + last[1]) / 2)), last[1] - first[1]];
  let side: LngLat = [-chord[1], chord[0]];
  if (side[1] < 0 || (Math.abs(side[1]) < 1e-9 && side[0] < 0)) side = [-side[0], -side[1]];

  return ground.map((point, i) => {
    if (i === 0 || i === ground.length - 1) return [...point] as LngLat;
    const prev = ground[i - 1];
    const next = ground[i + 1];
    const cos = Math.cos(rad(point[1]));
    let nx = -(next[1] - prev[1]);
    let ny = (next[0] - prev[0]) * cos;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    if (nx * side[0] + ny * side[1] < 0) {
      nx = -nx;
      ny = -ny;
    }
    const offset = Math.sin(Math.PI * (cumulative[i] / total)) * height;
    const lat = Math.max(-85, Math.min(85, point[1] + ny * offset));
    return [point[0] + (nx * offset) / Math.max(cos, 0.05), lat];
  });
}

/** The first `fraction` (0..1) of a line by length, ending on an interpolated tip. */
export function sliceLine(line: LngLat[], fraction: number): LngLat[] {
  if (line.length === 0) return [];
  if (fraction <= 0) return [line[0]];
  if (fraction >= 1) return line.map((p) => [...p] as LngLat);
  const lengths = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i][0], p[1] - line[i][1]));
  let remaining = lengths.reduce((a, b) => a + b, 0) * fraction;
  const out: LngLat[] = [line[0]];
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const k = lengths[i] === 0 ? 0 : remaining / lengths[i];
      const [x1, y1] = line[i];
      const [x2, y2] = line[i + 1];
      out.push([x1 + (x2 - x1) * k, y1 + (y2 - y1) * k]);
      return out;
    }
    remaining -= lengths[i];
    out.push(line[i + 1]);
  }
  return out;
}

export function latencyBand(ms: number | null | undefined): LatencyBand {
  if (ms === null || ms === undefined) return "unknown";
  if (ms < 50) return "fast";
  if (ms < 150) return "medium";
  if (ms < 300) return "slow";
  return "critical";
}

const sameSpot = (a: LngLat, b: LngLat) => Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4;

const hopLabel = (hops: number[]) =>
  hops.length === 1 ? String(hops[0]) : `${hops[0]}–${hops[hops.length - 1]}`;

function primaryGeo(hop: EnrichedHop): GeoInfo | null {
  return hop.addresses[0]?.geo ?? null;
}

export function buildRoute(origin: GeoInfo | null, hops: EnrichedHop[]): RouteGeometry {
  const stops: RouteStop[] = [];
  if (origin) {
    stops.push({
      id: "origin",
      kind: "origin",
      hops: [],
      label: "Origin",
      coord: [origin.lon, origin.lat],
      band: "unknown",
      city: origin.city,
      countryCode: origin.countryCode,
    });
  }

  for (const hop of [...hops].sort((a, b) => a.hop - b.hop)) {
    const geo = primaryGeo(hop);
    if (!geo) continue;
    const coord: LngLat = [geo.lon, geo.lat];
    const band = latencyBand(hop.rtt?.avg);
    const last = stops.at(-1);
    if (last && last.kind === "hop" && sameSpot(last.coord, coord)) {
      last.hops.push(hop.hop);
      last.label = hopLabel(last.hops);
      last.band = band;
      continue;
    }
    stops.push({
      id: `hop-${hop.hop}`,
      kind: "hop",
      hops: [hop.hop],
      label: String(hop.hop),
      coord,
      band,
      city: geo.city,
      countryCode: geo.countryCode,
    });
  }

  const coordinates: LngLat[] = [];
  const segments: RouteGeometry["segments"]["features"] = [];
  const ground: RouteGeometry["ground"]["features"] = [];
  let distanceKm = 0;
  for (let i = 1; i < stops.length; i++) {
    const from = coordinates.at(-1) ?? stops[i - 1].coord;
    const km = haversineKm(stops[i - 1].coord, stops[i].coord);
    distanceKm += km;
    const track = greatCircle(from, stops[i].coord, Math.min(128, Math.max(16, Math.ceil(km / 60))));
    const arc = liftedArc(track);
    const properties = { band: stops[i].band, key: `${stops[i - 1].id}>${stops[i].id}` };
    segments.push({ type: "Feature", properties, geometry: { type: "LineString", coordinates: arc } });
    ground.push({ type: "Feature", properties, geometry: { type: "LineString", coordinates: track } });
    coordinates.push(...(coordinates.length ? arc.slice(1) : arc));
  }

  let bounds: RouteGeometry["bounds"] = null;
  if (stops.length) {
    const lons = stops.map((s) => s.coord[0]);
    const lats = stops.map((s) => s.coord[1]);
    bounds = [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ];
  }

  return {
    stops,
    line: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
    segments: { type: "FeatureCollection", features: segments },
    ground: { type: "FeatureCollection", features: ground },
    bounds,
    distanceKm,
  };
}
