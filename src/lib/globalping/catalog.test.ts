import { describe, expect, it, vi } from "vitest";
import { createProbeCatalog, groupProbes, nearestLocation, type RawProbe } from "./catalog";

const probe = (country: string, city: string, asn: number, network: string, lat: number, lon: number): RawProbe => ({
  location: { continent: "SA", country, city, asn, network, latitude: lat, longitude: lon },
});

const RAW: RawProbe[] = [
  probe("AR", "Buenos Aires", 7303, "Telecom Argentina", -34.6, -58.4),
  probe("AR", "Buenos Aires", 7303, "Telecom Argentina", -34.62, -58.38),
  probe("AR", "Buenos Aires", 136907, "HUAWEI CLOUDS", -34.61, -58.38),
  probe("ES", "Madrid", 3352, "Telefonica", 40.4, -3.7),
];

describe("groupProbes", () => {
  it("groups probes by city with their networks, busiest network first", () => {
    const groups = groupProbes(RAW);
    expect(groups.map((g) => g.id)).toEqual(["ar-buenos-aires", "es-madrid"]);
    expect(groups[0]).toMatchObject({ city: "Buenos Aires", country: "AR", probes: 3 });
    expect(groups[0].networks).toEqual([
      { asn: 7303, network: "Telecom Argentina", probes: 2 },
      { asn: 136907, network: "HUAWEI CLOUDS", probes: 1 },
    ]);
    expect(groups[0].lat).toBeCloseTo(-34.61, 2);
    expect(groups[0].lon).toBeCloseTo(-58.387, 2);
  });

  it("skips probes without coordinates or city", () => {
    const broken = [{ location: { country: "US", city: "", asn: 1, network: "x", latitude: 1, longitude: 1 } }] as RawProbe[];
    expect(groupProbes(broken)).toEqual([]);
  });
});

describe("nearestLocation", () => {
  it("picks the closest city", () => {
    const groups = groupProbes(RAW);
    expect(nearestLocation(groups, 41.39, 2.17)?.id).toBe("es-madrid");
    expect(nearestLocation(groups, -31.4, -64.2)?.id).toBe("ar-buenos-aires");
    expect(nearestLocation([], 0, 0)).toBeNull();
  });
});

describe("createProbeCatalog", () => {
  const response = () => new Response(JSON.stringify(RAW), { status: 200 });

  it("fetches the probe list once and caches it for ten minutes", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    let now = 0;
    const catalog = createProbeCatalog({ fetchImpl, now: () => now });
    await catalog.locations();
    await catalog.locations();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now = 10 * 60 * 1000;
    await catalog.locations();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("finds a location by id and returns null for unknown ids", async () => {
    const catalog = createProbeCatalog({ fetchImpl: vi.fn<typeof fetch>(async () => response()) });
    expect((await catalog.find("es-madrid"))?.city).toBe("Madrid");
    expect(await catalog.find("xx-nowhere")).toBeNull();
  });

  it("keeps serving the last list if a refresh fails", async () => {
    let now = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error("down"));
    const catalog = createProbeCatalog({ fetchImpl, now: () => now });
    await catalog.locations();
    now = 11 * 60 * 1000;
    expect(await catalog.locations()).toHaveLength(2);
  });
});
