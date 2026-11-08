import { describe, expect, it } from "vitest";
import type { ProbeLocation } from "@/lib/globalping/catalog";
import { filterLocations, originLabel, traceUrl, type TraceOrigin } from "./origins";

const loc = (id: string, city: string, country: string, networks: string[] = []): ProbeLocation => ({
  id,
  city,
  country,
  continent: "",
  lat: 0,
  lon: 0,
  probes: networks.length || 1,
  networks: networks.map((network, i) => ({ asn: 100 + i, network, probes: 1 })),
});

const LOCATIONS = [
  loc("ar-buenos-aires", "Buenos Aires", "AR", ["Telecom Argentina", "HUAWEI CLOUDS"]),
  loc("ar-cordoba", "Córdoba", "AR"),
  loc("es-madrid", "Madrid", "ES", ["Telefonica"]),
  loc("ph-cordova", "Cordova", "PH"),
  loc("us-new-york", "New York", "US"),
];

describe("traceUrl", () => {
  it("builds the trace URL for each origin", () => {
    expect(traceUrl("example.com", { kind: "local" })).toBe("/api/trace?target=example.com");
    expect(traceUrl("example.com", { kind: "remote", locationId: "es-madrid" })).toBe(
      "/api/trace?target=example.com&from=es-madrid",
    );
    expect(traceUrl("a b", { kind: "remote", locationId: "es-madrid", asn: 3352 })).toBe(
      "/api/trace?target=a+b&from=es-madrid&asn=3352",
    );
  });
});

describe("filterLocations", () => {
  it("matches cities ignoring case and accents, best matches first", () => {
    expect(filterLocations(LOCATIONS, "cord").map((l) => l.id)).toEqual(["ar-cordoba", "ph-cordova"]);
    expect(filterLocations(LOCATIONS, "CÓRDOBA").map((l) => l.id)).toEqual(["ar-cordoba"]);
  });

  it("matches country codes and network names", () => {
    expect(filterLocations(LOCATIONS, "ar").map((l) => l.id)).toEqual(["ar-buenos-aires", "ar-cordoba"]);
    expect(filterLocations(LOCATIONS, "telefonica").map((l) => l.id)).toEqual(["es-madrid"]);
  });

  it("returns everything (capped) for an empty query", () => {
    expect(filterLocations(LOCATIONS, "  ")).toHaveLength(5);
    expect(filterLocations(LOCATIONS, "", 2)).toHaveLength(2);
  });
});

describe("originLabel", () => {
  it("describes each origin in plain words", () => {
    expect(originLabel({ kind: "local" }, LOCATIONS)).toBe("This computer");
    expect(originLabel({ kind: "remote", locationId: "ar-buenos-aires" }, LOCATIONS)).toBe("Buenos Aires, AR");
    const pinned: TraceOrigin = { kind: "remote", locationId: "ar-buenos-aires", asn: 100 };
    expect(originLabel(pinned, LOCATIONS)).toBe("Buenos Aires, AR · Telecom Argentina");
    expect(originLabel({ kind: "remote", locationId: "zz-gone" }, LOCATIONS)).toBe("Choose a location");
  });
});
