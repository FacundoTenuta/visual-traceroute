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
