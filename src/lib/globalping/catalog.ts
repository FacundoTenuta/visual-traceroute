import { haversineKm } from "@/lib/geo/route";

/** One probe as listed by `GET https://api.globalping.io/v1/probes` (fields we use). */
export interface RawProbe {
  location: {
    continent?: string;
    country: string;
    city: string;
    asn: number;
    network: string;
    latitude: number;
    longitude: number;
  };
}

export interface ProbeNetwork {
  asn: number;
  network: string;
  probes: number;
}

/** A city with online probes: what the user picks as the trace origin. */
export interface ProbeLocation {
  id: string;
  city: string;
  country: string;
  continent: string;
  lat: number;
  lon: number;
  probes: number;
  networks: ProbeNetwork[];
}

const PROBES_URL = "https://api.globalping.io/v1/probes";
const TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;

const slug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function groupProbes(raw: RawProbe[]): ProbeLocation[] {
  const byCity = new Map<string, ProbeLocation & { latSum: number; lonSum: number }>();
  for (const { location: l } of raw) {
    if (!l?.city || !l.country || !Number.isFinite(l.latitude) || !Number.isFinite(l.longitude)) continue;
    const id = `${l.country.toLowerCase()}-${slug(l.city)}`;
    let group = byCity.get(id);
    if (!group) {
      group = {
        id,
        city: l.city,
        country: l.country,
        continent: l.continent ?? "",
        lat: 0,
        lon: 0,
        probes: 0,
        networks: [],
        latSum: 0,
        lonSum: 0,
      };
      byCity.set(id, group);
    }
    group.probes++;
    group.latSum += l.latitude;
    group.lonSum += l.longitude;
    const network = group.networks.find((n) => n.asn === l.asn);
    if (network) network.probes++;
    else group.networks.push({ asn: l.asn, network: l.network, probes: 1 });
  }
  return [...byCity.values()]
    .map(({ latSum, lonSum, ...group }) => ({
      ...group,
      lat: Math.round((latSum / group.probes) * 1000) / 1000,
      lon: Math.round((lonSum / group.probes) * 1000) / 1000,
      networks: group.networks.sort((a, b) => b.probes - a.probes || a.network.localeCompare(b.network)),
    }))
    .sort((a, b) => a.country.localeCompare(b.country) || a.city.localeCompare(b.city));
}

export function nearestLocation(locations: ProbeLocation[], lat: number, lon: number): ProbeLocation | null {
  let best: ProbeLocation | null = null;
  let bestKm = Infinity;
  for (const location of locations) {
    const km = haversineKm([lon, lat], [location.lon, location.lat]);
    if (km < bestKm) {
      best = location;
      bestKm = km;
    }
  }
  return best;
}

export function createProbeCatalog({ fetchImpl = fetch, now = Date.now }: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
  let cached: { at: number; locations: ProbeLocation[] } | null = null;
  let inflight: Promise<ProbeLocation[]> | null = null;

  async function load(): Promise<ProbeLocation[]> {
    const res = await fetchImpl(PROBES_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Globalping probes: HTTP ${res.status}`);
    return groupProbes((await res.json()) as RawProbe[]);
  }

  async function locations(): Promise<ProbeLocation[]> {
    if (cached && now() - cached.at < TTL_MS) return cached.locations;
    inflight ??= load()
      .then((list) => {
        cached = { at: now(), locations: list };
        return list;
      })
      .catch((error) => {
        // A stale list beats no list: probes rarely move.
        if (cached) return cached.locations;
        throw error;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  return {
    locations,
    find: async (id: string) => (await locations()).find((l) => l.id === id) ?? null,
  };
}

export const probeCatalog = createProbeCatalog();
