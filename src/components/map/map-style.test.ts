import { describe, expect, it } from "vitest";
import { buildStyle, EMPTY } from "./map-style";

const style = buildStyle("dark", { segments: EMPTY, stops: EMPTY }, null);
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
