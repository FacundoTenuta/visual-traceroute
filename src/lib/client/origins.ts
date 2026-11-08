import type { ProbeLocation } from "@/lib/globalping/catalog";

/** Where a trace runs: on the server running the app, or on a remote probe location. */
export type TraceOrigin = { kind: "local" } | { kind: "remote"; locationId: string; asn?: number };

export function traceUrl(target: string, origin: TraceOrigin): string {
  const params = new URLSearchParams({ target });
  if (origin.kind === "remote") {
    params.set("from", origin.locationId);
    if (origin.asn !== undefined) params.set("asn", String(origin.asn));
  }
  return `/api/trace?${params}`;
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Search by city, country code or network; city-prefix matches rank first. */
export function filterLocations(locations: ProbeLocation[], query: string, limit = 60): ProbeLocation[] {
  const q = fold(query);
  if (!q) return locations.slice(0, limit);
  const scored: Array<[number, ProbeLocation]> = [];
  for (const location of locations) {
    const city = fold(location.city);
    let score = -1;
    if (city.startsWith(q)) score = 0;
    else if (fold(location.country) === q) score = 1;
    else if (city.includes(q)) score = 2;
    else if (location.networks.some((n) => fold(n.network).includes(q))) score = 3;
    if (score >= 0) scored.push([score, location]);
  }
  return scored
    .sort(([a, la], [b, lb]) => a - b || la.city.localeCompare(lb.city))
    .slice(0, limit)
    .map(([, location]) => location);
}

export function originLabel(origin: TraceOrigin, locations: ProbeLocation[]): string {
  if (origin.kind === "local") return "This computer";
  const location = locations.find((l) => l.id === origin.locationId);
  if (!location) return "Choose a location";
  const place = `${location.city}, ${location.country}`;
  const network = origin.asn === undefined ? null : location.networks.find((n) => n.asn === origin.asn);
  return network ? `${place} · ${network.network}` : place;
}
