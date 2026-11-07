import type { EnrichedHop, GeoInfo } from "@/lib/traceroute/types";

export type LngLat = [number, number];
export type LatencyBand = "fast" | "medium" | "slow" | "critical" | "unknown";

export interface RouteStop {
  id: string;
  kind: "origin" | "hop";
  /** Every hop seen at this location, ascending (empty for the origin). */
  hops: number[];
  label: string;
  coord: LngLat;
  band: LatencyBand;
  /** Average RTT of the latest hop seen at this stop, if any. */
  rtt: number | null;
  city: string | null;
  countryCode: string | null;
}

export interface SegmentProps {
  band: LatencyBand;
  /** Stable id (`from>to#n`) so the map animates each segment only once. */
  key: string;
  /** RTT of the hop the segment arrives at: one colour per segment. */
  rtt: number | null;
  km: number;
  /** Stop ids at both ends. */
  from: string;
  to: string;
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

const spotKey = ([lon, lat]: LngLat) => `${lon.toFixed(4)},${lat.toFixed(4)}`;

/** "3, 4, 5, 9" → "3–5, 9". */
function hopLabel(hops: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < hops.length; i++) {
    let j = i;
    while (j + 1 < hops.length && hops[j + 1] === hops[j] + 1) j++;
    parts.push(i === j ? String(hops[i]) : `${hops[i]}–${hops[j]}`);
    i = j;
  }
  return parts.join(", ");
}

function primaryGeo(hop: EnrichedHop): GeoInfo | null {
  return hop.addresses[0]?.geo ?? null;
}

/**
 * Bows a ground track sideways (perpendicular to its chord), peaking mid-way.
 * `ratio` is the peak offset as a fraction of the segment length; the sign
 * picks the side. Used to separate segments repeated between the same places.
 */
export function bendTrack(track: LngLat[], ratio: number): LngLat[] {
  if (ratio === 0 || track.length < 3) return track.map((p) => [...p] as LngLat);
  const first = track[0];
  const last = track[track.length - 1];
  const cos = Math.cos(rad((first[1] + last[1]) / 2)) || 1;
  const dx = (last[0] - first[0]) * cos;
  const dy = last[1] - first[1];
  const length = Math.hypot(dx, dy) || 1;
  const [nx, ny] = [-dy / length, dx / length];
  const end = track.length - 1;
  return track.map((point, i) => {
    if (i === 0 || i === end) return [...point] as LngLat;
    const offset = Math.sin(Math.PI * (i / end)) * ratio * length;
    const lat = Math.max(-85, Math.min(85, point[1] + ny * offset));
    return [point[0] + (nx * offset) / Math.max(Math.cos(rad(point[1])), 0.05), lat];
  });
}

/** Sideways bend for the n-th repetition of a pair: 0, then +, −, ++, −− … */
const REPEAT_BEND = 0.14;
const repeatBend = (n: number) => (n === 0 ? 0 : (n % 2 === 1 ? 1 : -1) * Math.ceil(n / 2) * REPEAT_BEND);

interface Visit {
  stop: RouteStop;
  rtt: number | null;
}

export function buildRoute(origin: GeoInfo | null, hops: EnrichedHop[]): RouteGeometry {
  const stops: RouteStop[] = [];
  const visits: Visit[] = [];
  if (origin) {
    const stop: RouteStop = {
      id: "origin",
      kind: "origin",
      hops: [],
      label: "Origin",
      coord: [origin.lon, origin.lat],
      band: "unknown",
      rtt: null,
      city: origin.city,
      countryCode: origin.countryCode,
    };
    stops.push(stop);
    visits.push({ stop, rtt: null });
  }

  // One pin per place: a hop at a location seen before joins that stop.
  const byPlace = new Map<string, RouteStop>();
  for (const hop of [...hops].sort((a, b) => a.hop - b.hop)) {
    const geo = primaryGeo(hop);
    if (!geo) continue;
    const coord: LngLat = [geo.lon, geo.lat];
    const rtt = hop.rtt?.avg ?? null;
    let stop = byPlace.get(spotKey(coord));
    if (stop) {
      stop.hops.push(hop.hop);
      stop.label = hopLabel(stop.hops);
      stop.band = latencyBand(rtt);
      stop.rtt = rtt;
    } else {
      stop = {
        id: `hop-${hop.hop}`,
        kind: "hop",
        hops: [hop.hop],
        label: String(hop.hop),
        coord,
        band: latencyBand(rtt),
        rtt,
        city: geo.city,
        countryCode: geo.countryCode,
      };
      stops.push(stop);
      byPlace.set(spotKey(coord), stop);
    }
    // Consecutive hops at the same place are one visit (the latest RTT wins).
    const last = visits.at(-1);
    if (last && last.stop === stop) last.rtt = rtt;
    else visits.push({ stop, rtt });
  }

  const coordinates: LngLat[] = [];
  const segments: RouteGeometry["segments"]["features"] = [];
  const arcs: Arc3D[] = [];
  const pairCount = new Map<string, number>();
  let distanceKm = 0;
  for (let i = 1; i < visits.length; i++) {
    const from = visits[i - 1].stop;
    const to = visits[i].stop;
    const start = coordinates.at(-1) ?? from.coord;
    const km = haversineKm(from.coord, to.coord);
    distanceKm += km;
    const pair = [from.id, to.id].sort().join("|");
    const n = pairCount.get(pair) ?? 0;
    pairCount.set(pair, n + 1);
    const steps = Math.min(128, Math.max(16, Math.ceil(km / 60)));
    const track = bendTrack(greatCircle(start, to.coord, steps), repeatBend(n));
    const properties: SegmentProps = {
      band: latencyBand(visits[i].rtt),
      key: `${from.id}>${to.id}#${n}`,
      rtt: visits[i].rtt,
      km,
      from: from.id,
      to: to.id,
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
