import { describe, expect, it } from "vitest";
import { buildStyle, EMPTY } from "./map-style";

const style = buildStyle("dark", { segments: EMPTY, stops: EMPTY, origin: EMPTY }, null);
const layer = (id: string) => style.layers.find((l) => l.id === id) as { layout?: Record<string, unknown> };

describe("map labels", () => {
  it.each(["place-country", "place-city"])("%s renames Falkland Islands to Islas Malvinas", (id) => {
    const text = JSON.stringify(layer(id).layout?.["text-field"]);
    expect(text).toContain('"Falkland Islands","Islas Malvinas"');
  });
});

describe("South Atlantic labels and disputed borders", () => {
  it.each(["place-country", "place-city"])("%s uses the Argentine names", (id) => {
    const text = JSON.stringify(layer(id).layout?.["text-field"]);
    expect(text).toContain('"South Georgia and South Sandwich Islands","Islas Georgias del Sur y Sandwich del Sur"');
    // Only the Stanley whose Spanish name is Puerto Argentino is renamed.
    expect(text).toContain('["==",["get","name:es"],"Puerto Argentino"],"Puerto Argentino"');
  });

  it("draws disputed country boundaries dashed and keeps them out of the solid border layer", () => {
    const disputed = style.layers.find((l) => l.id === "boundary-disputed") as {
      filter?: unknown;
      paint?: Record<string, unknown>;
    };
    expect(JSON.stringify(disputed.filter)).toContain('["==",["get","disputed"],1]');
    expect(disputed.paint?.["line-dasharray"]).toBeDefined();
    const solid = style.layers.find((l) => l.id === "boundary-country") as { filter?: unknown };
    expect(JSON.stringify(solid.filter)).toContain('["!=",["get","disputed"],1]');
  });
});

describe("pins and clusters", () => {
  const sources = style.sources as Record<string, Record<string, unknown>>;
  const find = (id: string) => style.layers.find((l) => l.id === id) as Record<string, unknown> | undefined;

  it("clusters hop pins and aggregates their hop range and worst RTT", () => {
    expect(sources.stops).toMatchObject({ type: "geojson", cluster: true });
    expect(Object.keys(sources.stops.clusterProperties as object).sort()).toEqual(["maxHop", "maxRtt", "minHop"]);
  });

  it("keeps the origin out of clustering", () => {
    expect(sources.origin).toMatchObject({ type: "geojson" });
    expect(sources.origin.cluster).toBeUndefined();
    expect(find("origin")?.source).toBe("origin");
  });

  it("labels a cluster with its hop range, not a count", () => {
    const label = JSON.stringify((find("stop-clusters-label")?.layout as Record<string, unknown>)["text-field"]);
    expect(label).toContain('"minHop"');
    expect(label).toContain('"maxHop"');
    expect(label).not.toContain("point_count");
    expect(JSON.stringify(find("stop-clusters")?.filter)).toContain('["has","point_count"]');
  });

  it("only draws single pins for unclustered points", () => {
    expect(JSON.stringify(find("stops")?.filter)).toContain('["!",["has","point_count"]]');
  });

  it("switches pin number colour for contrast on slow (red) pins", () => {
    const color = JSON.stringify((find("stops-label")?.paint as Record<string, unknown>)["text-color"]);
    expect(color).toContain('"rtt"');
  });
});
