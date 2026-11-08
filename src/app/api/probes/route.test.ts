import { describe, expect, it, vi } from "vitest";

const LOCATIONS = [
  { id: "ar-buenos-aires", city: "Buenos Aires", country: "AR", continent: "SA", lat: -34.6, lon: -58.4, probes: 3, networks: [{ asn: 7303, network: "Telecom Argentina", probes: 3 }] },
  { id: "es-madrid", city: "Madrid", country: "ES", continent: "EU", lat: 40.4, lon: -3.7, probes: 2, networks: [{ asn: 3352, network: "Telefonica", probes: 2 }] },
];
vi.mock("@/lib/globalping/catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/globalping/catalog")>()),
  probeCatalog: { locations: vi.fn(async () => LOCATIONS), find: vi.fn() },
}));
const localAvailable = vi.fn(async () => false);
vi.mock("@/lib/traceroute/available", () => ({ isLocalTraceAvailable: localAvailable }));
const origin = vi.fn(async () => null);
vi.mock("@/lib/geo/ip-api", () => ({ ipApi: { origin, geolocate: vi.fn() } }));

const { GET } = await import("./route");

describe("GET /api/probes", () => {
  it("lists probe locations and suggests the one nearest the visitor (Vercel geo headers)", async () => {
    const res = await GET(
      new Request("http://localhost/api/probes", {
        headers: { "x-vercel-ip-latitude": "41.39", "x-vercel-ip-longitude": "2.17" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nearest).toBe("es-madrid");
    expect(body.local).toBe(false);
    expect(body.locations).toHaveLength(2);
    expect(body.locations[0]).toEqual(LOCATIONS[0]);
  });

  it("falls back to this server's own location when there are no geo headers", async () => {
    origin.mockResolvedValueOnce({ lat: -31.4, lon: -64.2 } as never);
    const body = await (await GET(new Request("http://localhost/api/probes"))).json();
    expect(body.nearest).toBe("ar-buenos-aires");
  });

  it("tells the client when local traces are available", async () => {
    localAvailable.mockResolvedValueOnce(true);
    const body = await (await GET(new Request("http://localhost/api/probes"))).json();
    expect(body.local).toBe(true);
  });
});
