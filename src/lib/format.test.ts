import { describe, expect, it } from "vitest";
import { flag, formatDuration, formatKm, formatLoss, formatMs } from "./format";

describe("format", () => {
  it.each([
    [null, "—"],
    [4.237, "4.2 ms"],
    [12.6, "13 ms"],
    [240, "240 ms"],
  ])("formatMs(%s) = %s", (ms, out) => expect(formatMs(ms)).toBe(out));

  it("formats distances, loss and durations", () => {
    expect(formatKm(5770.4)).toBe("5,770 km");
    expect(formatLoss(1 / 3)).toBe("33%");
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(12_340)).toBe("12.3 s");
  });

  it("builds flag emoji from country codes", () => {
    expect(flag("ES")).toBe("🇪🇸");
    expect(flag("us")).toBe("🇺🇸");
    expect(flag(null)).toBe("");
    expect(flag("XYZ")).toBe("");
  });
});
