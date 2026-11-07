import { TtlLru } from "@/lib/cache/lru";
import type { GeoInfo } from "@/lib/traceroute/types";

const FIELDS = "status,message,query,country,countryCode,regionName,city,lat,lon,timezone,isp,org,as,asname";
// The free endpoint is HTTP only and allows 45 requests/minute per caller.
// With IPAPI_KEY set, the HTTPS pro endpoint is used instead.
const FREE_URL = "http://ip-api.com/json/";
const PRO_URL = "https://pro.ip-api.com/json/";
const TIMEOUT_MS = 4000;
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const ORIGIN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_WAIT_S = 60;
const MAX_TEXT = 120;

interface IpApiResponse {
  status?: unknown;
  query?: unknown;
  country?: unknown;
  countryCode?: unknown;
  regionName?: unknown;
  city?: unknown;
  lat?: unknown;
  lon?: unknown;
  timezone?: unknown;
  isp?: unknown;
  org?: unknown;
  as?: unknown;
  asname?: unknown;
}

/** Provider strings are untrusted (and travel over plain HTTP): type-check, trim and cap them. */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_TEXT);
  return trimmed || null;
}

function toGeo(body: IpApiResponse): GeoInfo | null {
  const { lat, lon } = body;
  if (body.status !== "success" || typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const ip = text(body.query);
  if (!ip) return null;
  const countryCode = text(body.countryCode);
  const asn = text(body.as)?.split(" ")[0] ?? null;
  return {
    ip,
    lat,
    lon,
    city: text(body.city),
    region: text(body.regionName),
    country: text(body.country),
    countryCode: countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
    timezone: text(body.timezone),
    isp: text(body.isp),
    org: text(body.org),
    asn: asn && /^AS\d+$/.test(asn) ? asn : null,
    asName: text(body.asname),
  };
}

type Outcome = { kind: "ok"; geo: GeoInfo | null } | { kind: "unavailable" };

export interface IpApiOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  apiKey?: string;
  /** Local budget: 40/minute keeps the free tier under its 45/minute limit; Pro defaults to 1000. */
  maxPerMinute?: number;
  cacheSize?: number;
}

export function createIpApiClient({
  fetchImpl = fetch,
  now = Date.now,
  apiKey,
  maxPerMinute = apiKey ? 1000 : 40,
  cacheSize = 2000,
}: IpApiOptions = {}) {
  const cache = new TtlLru<GeoInfo | null>({ maxEntries: cacheSize, now });
  const inflight = new Map<string, Promise<GeoInfo | null>>();
  const sent: number[] = [];
  let blockedUntil = 0;
  let origin: { expiresAt: number; value: Promise<GeoInfo | null> } | null = null;

  const block = (seconds: number) => {
    blockedUntil = Math.max(blockedUntil, now() + (seconds > 0 ? seconds : DEFAULT_WAIT_S) * 1000);
  };

  function hasBudget(): boolean {
    const t = now();
    if (t < blockedUntil) return false;
    while (sent.length && sent[0] <= t - 60_000) sent.shift();
    return sent.length < maxPerMinute;
  }

  async function request(path: string): Promise<Outcome> {
    if (!hasBudget()) return { kind: "unavailable" };
    sent.push(now());
    const base = apiKey ? PRO_URL : FREE_URL;
    const key = apiKey ? `&key=${encodeURIComponent(apiKey)}` : "";
    try {
      const res = await fetchImpl(`${base}${path}?fields=${FIELDS}${key}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const remaining = Number(res.headers.get("x-rl"));
      const wait = Number(res.headers.get("x-ttl"));
      if (res.status === 429) {
        block(wait);
        return { kind: "unavailable" };
      }
      if (res.headers.has("x-rl") && remaining <= 0) block(wait);
      if (!res.ok) return { kind: "unavailable" };
      return { kind: "ok", geo: toGeo((await res.json()) as IpApiResponse) };
    } catch {
      return { kind: "unavailable" };
    }
  }

  function geolocate(ip: string): Promise<GeoInfo | null> {
    if (cache.has(ip)) return Promise.resolve(cache.get(ip) ?? null);
    let pending = inflight.get(ip);
    if (!pending) {
      pending = request(encodeURIComponent(ip)).then((outcome) => {
        inflight.delete(ip);
        if (outcome.kind === "unavailable") return null; // not cached: retry once the budget allows
        cache.set(ip, outcome.geo, outcome.geo ? SUCCESS_TTL_MS : FAILURE_TTL_MS);
        return outcome.geo;
      });
      inflight.set(ip, pending);
    }
    return pending;
  }

  function lookupOrigin(): Promise<GeoInfo | null> {
    if (!origin || now() >= origin.expiresAt) {
      const value = request("").then((outcome) => (outcome.kind === "ok" ? outcome.geo : null));
      origin = { expiresAt: now() + ORIGIN_TTL_MS, value };
      value.then((geo) => {
        if (geo === null) origin = null;
      });
    }
    return origin.value;
  }

  return { geolocate, origin: lookupOrigin };
}

/** Process-wide client so the cache and rate budget are shared across requests. */
export const ipApi = createIpApiClient({ apiKey: process.env.IPAPI_KEY || undefined });
