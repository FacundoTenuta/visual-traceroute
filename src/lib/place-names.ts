/**
 * Place names shown differently from the data sources (OpenStreetMap tiles and
 * ip-api), keyed by the English name those sources use.
 */
export const PLACE_NAME_OVERRIDES: Record<string, string> = {
  "Falkland Islands": "Islas Malvinas",
  "South Georgia and South Sandwich Islands": "Islas Georgias del Sur y Sandwich del Sur",
};

/**
 * "Stanley" is a common place name, so it is only renamed where the data marks
 * it as the Malvinas capital: `name:es` in the map tiles, country FK in ip-api.
 */
export const MALVINAS_CAPITAL = { source: "Stanley", spanish: "Puerto Argentino", countryCode: "FK" };

const normalize = (name: string) => name.trim().toLowerCase();
const BY_NORMALIZED = new Map(Object.entries(PLACE_NAME_OVERRIDES).map(([from, to]) => [normalize(from), to]));
// ip-api and other providers sometimes append the alternative in parentheses.
const PROVIDER_ALIASES = new Map([
  ["falkland islands (malvinas)", "Islas Malvinas"],
  ["south georgia and the south sandwich islands", "Islas Georgias del Sur y Sandwich del Sur"],
]);

export function displayCountry(name: string | null): string | null {
  if (name === null) return null;
  const key = normalize(name);
  return BY_NORMALIZED.get(key) ?? PROVIDER_ALIASES.get(key) ?? name;
}

export function displayCity(name: string | null, countryCode: string | null): string | null {
  if (name === null) return null;
  const { source, spanish, countryCode: code } = MALVINAS_CAPITAL;
  return countryCode === code && normalize(name) === normalize(source) ? spanish : name;
}
