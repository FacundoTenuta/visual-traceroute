import { describe, expect, it } from "vitest";
import { displayCity, displayCountry, PLACE_NAME_OVERRIDES } from "./place-names";

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

describe("South Atlantic names", () => {
  it("names South Georgia and the South Sandwich Islands in Spanish", () => {
    expect(PLACE_NAME_OVERRIDES["South Georgia and South Sandwich Islands"]).toBe("Islas Georgias del Sur y Sandwich del Sur");
    expect(displayCountry("South Georgia and the South Sandwich Islands")).toBe("Islas Georgias del Sur y Sandwich del Sur");
  });

  it("names Stanley in the Malvinas Puerto Argentino, and no other Stanley", () => {
    expect(displayCity("Stanley", "FK")).toBe("Puerto Argentino");
    expect(displayCity("Stanley", "GB")).toBe("Stanley");
    expect(displayCity("Stanley", null)).toBe("Stanley");
    expect(displayCity("Buenos Aires", "AR")).toBe("Buenos Aires");
    expect(displayCity(null, "FK")).toBeNull();
  });
});
