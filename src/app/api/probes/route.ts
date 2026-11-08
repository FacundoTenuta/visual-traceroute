import { nearestLocation, probeCatalog } from "@/lib/globalping/catalog";
import { ipApi } from "@/lib/geo/ip-api";
import { isLocalTraceAvailable } from "@/lib/traceroute/available";

const MAX_NETWORKS = 6;

/** The visitor's approximate position: Vercel's geo headers, else this server's own location. */
async function visitorPosition(request: Request): Promise<{ lat: number; lon: number } | null> {
  const lat = Number(request.headers.get("x-vercel-ip-latitude"));
  const lon = Number(request.headers.get("x-vercel-ip-longitude"));
  if (request.headers.has("x-vercel-ip-latitude") && Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  const here = await ipApi.origin().catch(() => null);
  return here ? { lat: here.lat, lon: here.lon } : null;
}

/**
 * Probe locations users can trace from, the one nearest the visitor (the
 * default origin) and whether this server can also trace locally.
 */
export async function GET(request: Request) {
  const [locations, position, local] = await Promise.all([
    probeCatalog.locations().catch(() => []),
    visitorPosition(request),
    isLocalTraceAvailable(),
  ]);
  const nearest = position ? (nearestLocation(locations, position.lat, position.lon)?.id ?? null) : null;
  // The busiest networks per city are enough to pick from and keep the payload small.
  const compact = locations.map((l) => ({ ...l, networks: l.networks.slice(0, MAX_NETWORKS) }));
  return Response.json(
    { locations: compact, nearest, local },
    // Per visitor (nearest depends on who asks), but cheap to reuse for a few minutes.
    { headers: { "cache-control": "private, max-age=300" } },
  );
}
