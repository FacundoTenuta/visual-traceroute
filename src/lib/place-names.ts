/**
 * Place names shown differently from the data sources (OpenStreetMap tiles and
 * ip-api), keyed by the English name those sources use.
 */
export const PLACE_NAME_OVERRIDES: Record<string, string> = {
  "Falkland Islands": "Islas Malvinas",
};

const normalize = (name: string) => name.trim().toLowerCase();
const BY_NORMALIZED = new Map(Object.entries(PLACE_NAME_OVERRIDES).map(([from, to]) => [normalize(from), to]));
// ip-api and other providers sometimes append the alternative in parentheses.
const PROVIDER_ALIASES = new Map([["falkland islands (malvinas)", "Islas Malvinas"]]);

export function displayCountry(name: string | null): string | null {
  if (name === null) return null;
  const key = normalize(name);
  return BY_NORMALIZED.get(key) ?? PROVIDER_ALIASES.get(key) ?? name;
}
