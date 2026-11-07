import { describe, expect, it } from "vitest";
import { LATENCY_STOPS, latencyColor, latencyGradientCss, latencyRgba } from "./latency-scale";

describe("latency scale", () => {
  it("starts at the current light blue and ends at red", () => {
    expect(latencyColor(0, "dark")).toBe("#7ee8ff");
    expect(latencyColor(0, "light")).toBe("#0a9fc4");
    expect(latencyColor(300, "dark")).toBe("#ff4d5e");
    expect(latencyColor(300, "light")).toBe("#d62839");
  });

  it("clamps beyond the ends of the scale", () => {
    expect(latencyColor(-5, "dark")).toBe("#7ee8ff");
    expect(latencyColor(900, "dark")).toBe("#ff4d5e");
  });

  it("interpolates continuously between stops", () => {
    expect(latencyColor(100, "dark")).toBe("#ffe08a");
    // Half way between #7ee8ff (0 ms) and #ffe08a (100 ms).
    expect(latencyColor(50, "dark")).toBe("#bfe4c5");
  });

  it("uses a neutral colour when the latency is unknown", () => {
    expect(latencyColor(null, "dark")).toBe("#6a86b5");
    expect(latencyColor(undefined, "light")).toBe("#8aa0c4");
  });

  it("returns RGBA tuples for WebGL layers", () => {
    expect(latencyRgba(0, "dark")).toEqual([126, 232, 255, 255]);
    expect(latencyRgba(null, "dark", 128)).toEqual([106, 134, 181, 128]);
  });

  it("builds a CSS gradient that matches the stops", () => {
    const css = latencyGradientCss("dark");
    expect(css.startsWith("linear-gradient(90deg, ")).toBe(true);
    for (const [, color] of LATENCY_STOPS.dark) expect(css).toContain(color);
  });
});
