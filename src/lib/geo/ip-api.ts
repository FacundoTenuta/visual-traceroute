import type { GeoInfo } from "@/lib/traceroute/types";

const FIELDS = "status,message,query,country,countryCode,regionName,city,lat,lon,timezone,isp,org,as,asname";
// ip-api's free tier is HTTP only and allows 45 requests/minute per caller.
const BASE_URL = "http://ip-api.com/json/";
const TIMEOUT_MS = 4000;
const ORIGIN_TTL_MS = 10 * 60 * 1000;

interface IpApiResponse {
  status?: "success" | "fail";
  query?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  isp?: string;
  org?: string;
  as?: string;
  asname?: string;
}

const orNull = (value: string | undefined) => (value ? value : null);

function toGeo(body: IpApiResponse): GeoInfo | null {
  if (body.status !== "success" || typeof body.lat !== "number" || typeof body.lon !== "number" || !body.query) {
    return null;
  }
  return {
    ip: body.query,
    lat: body.lat,
    lon: body.lon,
    city: orNull(body.city),
    region: orNull(body.regionName),
    country: orNull(body.country),
    countryCode: orNull(body.countryCode),
    timezone: orNull(body.timezone),
    isp: orNull(body.isp),
    org: orNull(body.org),
    asn: body.as?.split(" ")[0] || null,
    asName: orNull(body.asname),
  };
}

export function createIpApiClient(fetchImpl: typeof fetch = fetch) {
  const cache = new Map<string, Promise<GeoInfo | null>>();
  let origin: { at: number; value: Promise<GeoInfo | null> } | null = null;

  async function request(path: string): Promise<GeoInfo | null> {
    const res = await fetchImpl(`${BASE_URL}${path}?fields=${FIELDS}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return toGeo((await res.json()) as IpApiResponse);
  }

  function cached(key: string, load: () => Promise<GeoInfo | null>) {
    let promise = cache.get(key);
    if (!promise) {
      promise = load()
        .catch(() => null)
        .then((value) => {
          // Only successful lookups are kept, so transient failures can be retried.
          if (value === null) cache.delete(key);
          return value;
        });
      cache.set(key, promise);
    }
    return promise;
  }

  return {
    geolocate: (ip: string) => cached(ip, () => request(encodeURIComponent(ip))),
    origin: () => {
      if (!origin || Date.now() - origin.at > ORIGIN_TTL_MS) {
        origin = { at: Date.now(), value: request("").catch(() => null) };
        origin.value.then((v) => {
          if (v === null) origin = null;
        });
      }
      return origin.value;
    },
  };
}

/** Process-wide client so the cache survives across requests. */
export const ipApi = createIpApiClient();
