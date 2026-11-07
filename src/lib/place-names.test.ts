import { describe, expect, it } from "vitest";
import { displayCountry, PLACE_NAME_OVERRIDES } from "./place-names";

describe("place name overrides", () => {
  it("names the Malvinas as Islas Malvinas", () => {
    expect(PLACE_NAME_OVERRIDES["Falkland Islands"]).toBe("Islas Malvinas");
    expect(displayCountry("Falkland Islands")).toBe("Islas Malvinas");
    expect(displayCountry("Falkland Islands (Malvinas)")).toBe("Islas Malvinas");
    expect(displayCountry("  falkland islands ")).toBe("Islas Malvinas");
  });

  it("leaves every other country untouched", () => {
    expect(displayCountry("Argentina")).toBe("Argentina");
    expect(displayCountry("United Kingdom")).toBe("United Kingdom");
    expect(displayCountry(null)).toBeNull();
  });
});
