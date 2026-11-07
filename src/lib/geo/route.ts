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
  /** Average RTT of the last hop grouped at this stop, if any. */
  rtt: number | null;
  city: string | null;
  countryCode: string | null;
}

export interface SegmentProps {
  band: LatencyBand;
  /** Stable id (`from>to`) so the map animates each segment only once. */
  key: string;
  /** RTT at the start and end of the segment, for the colour gradient. */
  fromRtt: number | null;
  rtt: number | null;
  km: number;
}

/** Longitude, latitude and altitude in metres. */
export type Position3 = [number, number, number];

export interface Arc3D extends SegmentProps {
  path: Position3[];
}

export interface RouteGeometry {
  stops: RouteStop[];
  line: GeoJSON.Feature<GeoJSON.LineString>;
  /** Great-circle ground tracks, one per pair of consecutive stops. */
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, SegmentProps>;
  /** The same segments lifted into 3D "jump" arcs above the globe. */
  arcs: Arc3D[];
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

const MIN_ARC_KM = 20;
/** Small lift at both ends so a 3D arc never sits exactly on (and flickers with) the globe surface. */
export const ARC_BASE_M = 2_000;
const MAX_ARC_ALTITUDE_M = 450_000;
const ARC_HEIGHT_RATIO = 0.1;

/** Peak height of a jump arc: proportional to its length, flat for hops inside one city. */
export function arcAltitudeM(km: number): number {
  if (km < MIN_ARC_KM) return 0;
  return Math.min(MAX_ARC_ALTITUDE_M, km * 1000 * ARC_HEIGHT_RATIO);
}

/** Lifts a ground track into a 3D arc whose altitude peaks mid-way (sin curve). */
export function liftTrack(track: LngLat[], km: number): Position3[] {
  const peak = arcAltitudeM(km);
  const last = track.length - 1;
  const base = peak > 0 ? ARC_BASE_M : 0;
  return track.map(([lon, lat], i) => [lon, lat, base + (last === 0 ? 0 : Math.sin(Math.PI * (i / last)) * peak)]);
}

/** Camera zoom that keeps a segment of `km` comfortably in view on the globe. */
export function zoomForSpan(km: number): number {
  return Math.min(5.2, Math.max(1.5, 5.2 - Math.log2(Math.max(km, 1) / 250)));
}

/** The first `fraction` (0..1) of a line by length, ending on an interpolated tip. */
export function sliceLine<P extends number[]>(line: P[], fraction: number): P[] {
  if (line.length === 0) return [];
  if (fraction <= 0) return [line[0]];
  if (fraction >= 1) return line.map((p) => [...p] as P);
  // Progress is measured on the ground (lon/lat); extra coordinates are interpolated too.
  const lengths = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i][0], p[1] - line[i][1]));
  let remaining = lengths.reduce((a, b) => a + b, 0) * fraction;
  const out: P[] = [line[0]];
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const k = lengths[i] === 0 ? 0 : remaining / lengths[i];
      // A tip almost on top of the previous vertex makes a degenerate segment
      // that renders as a spike; drop it.
      if (k < 1e-3) return out;
      const a = line[i];
      const b = line[i + 1];
      out.push(a.map((v, j) => v + (b[j] - v) * k) as P);
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
      rtt: null,
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
      last.rtt = hop.rtt?.avg ?? null;
      continue;
    }
    stops.push({
      id: `hop-${hop.hop}`,
      kind: "hop",
      hops: [hop.hop],
      label: String(hop.hop),
      coord,
      band,
      rtt: hop.rtt?.avg ?? null,
      city: geo.city,
      countryCode: geo.countryCode,
    });
  }

  const coordinates: LngLat[] = [];
  const segments: RouteGeometry["segments"]["features"] = [];
  const arcs: Arc3D[] = [];
  let distanceKm = 0;
  for (let i = 1; i < stops.length; i++) {
    const from = coordinates.at(-1) ?? stops[i - 1].coord;
    const km = haversineKm(stops[i - 1].coord, stops[i].coord);
    distanceKm += km;
    const track = greatCircle(from, stops[i].coord, Math.min(128, Math.max(16, Math.ceil(km / 60))));
    const properties: SegmentProps = {
      band: stops[i].band,
      key: `${stops[i - 1].id}>${stops[i].id}`,
      // The origin has no RTT of its own; the line starts at the first hop's colour.
      fromRtt: stops[i - 1].rtt ?? stops[i].rtt,
      rtt: stops[i].rtt,
      km,
    };
    segments.push({ type: "Feature", properties, geometry: { type: "LineString", coordinates: track } });
    arcs.push({ ...properties, path: liftTrack(track, km) });
    coordinates.push(...(coordinates.length ? track.slice(1) : track));
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
    arcs,
    bounds,
    distanceKm,
  };
}
