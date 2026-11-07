export type ScaleTheme = "light" | "dark";

/** Round-trip time (ms) → colour, from light blue (fast) to red (slow). */
export const LATENCY_STOPS: Record<ScaleTheme, Array<[number, string]>> = {
  dark: [
    [0, "#7ee8ff"],
    [100, "#ffe08a"],
    [200, "#ff9a4d"],
    [300, "#ff4d5e"],
  ],
  light: [
    [0, "#0a9fc4"],
    [100, "#d9a300"],
    [200, "#e8661a"],
    [300, "#d62839"],
  ],
};

export const UNKNOWN_LATENCY: Record<ScaleTheme, string> = { dark: "#6a86b5", light: "#8aa0c4" };
export const LATENCY_MAX_MS = 300;

const toRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

export function latencyColor(ms: number | null | undefined, theme: ScaleTheme): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return UNKNOWN_LATENCY[theme];
  const stops = LATENCY_STOPS[theme];
  if (ms <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, c1] = stops[i];
    if (ms <= x1) {
      const [x0, c0] = stops[i - 1];
      const t = (ms - x0) / (x1 - x0);
      const a = toRgb(c0);
      const b = toRgb(c1);
      return toHex(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return stops[stops.length - 1][1];
}

export function latencyRgba(ms: number | null | undefined, theme: ScaleTheme, alpha = 255): [number, number, number, number] {
  const [r, g, b] = toRgb(latencyColor(ms, theme));
  return [r, g, b, alpha];
}

export function latencyGradientCss(theme: ScaleTheme): string {
  const stops = LATENCY_STOPS[theme].map(([ms, color]) => `${color} ${(ms / LATENCY_MAX_MS) * 100}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
