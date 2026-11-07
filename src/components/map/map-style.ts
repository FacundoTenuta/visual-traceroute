import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";
import type { LatencyBand } from "@/lib/geo/route";

export type ResolvedTheme = "light" | "dark";

interface Palette {
  land: string;
  wood: string;
  ice: string;
  ocean: string;
  waterway: string;
  border: string;
  borderState: string;
  roadMajor: string;
  roadMinor: string;
  building: string;
  labelCountry: string;
  labelPlace: string;
  halo: string;
  sky: string;
  horizon: string;
  fog: string;
  stopStroke: string;
  stopText: string;
  bands: Record<LatencyBand, string>;
}

/** Deep-ocean cable chart. */
const DARK: Palette = {
  land: "#1c3c74",
  wood: "#1f4079",
  ice: "#2a4b84",
  ocean: "#081834",
  waterway: "#12305f",
  border: "#4268a8",
  borderState: "#27477d",
  roadMajor: "#2d5593",
  roadMinor: "#1f3f6f",
  building: "#1c3968",
  labelCountry: "#9db8e8",
  labelPlace: "#cbdbf8",
  halo: "#0b1f45",
  sky: "#06122b",
  horizon: "#1d4a8c",
  fog: "#0b1f45",
  stopStroke: "#06122b",
  stopText: "#06122b",
  bands: { fast: "#7ee8ff", medium: "#4fa3ff", slow: "#8c7bff", critical: "#c86bff", unknown: "#6a86b5" },
};

/** Cyanotype print. */
const LIGHT: Palette = {
  land: "#f5f9fe",
  wood: "#ecf3fb",
  ice: "#ffffff",
  ocean: "#a6c6ea",
  waterway: "#97bce6",
  border: "#6f97cc",
  borderState: "#bed2ea",
  roadMajor: "#a9c3e5",
  roadMinor: "#d6e3f3",
  building: "#dde8f6",
  labelCountry: "#2f5694",
  labelPlace: "#173c78",
  halo: "#f5f9fe",
  sky: "#eaf2fb",
  horizon: "#a9c8ee",
  fog: "#eaf2fb",
  stopStroke: "#ffffff",
  stopText: "#ffffff",
  bands: { fast: "#0a9fc4", medium: "#1f63e0", slow: "#5b3fd6", critical: "#9a2fc7", unknown: "#8aa0c4" },
};

export const PALETTES: Record<ResolvedTheme, Palette> = { dark: DARK, light: LIGHT };

const NAME: ExpressionSpecification = ["coalesce", ["get", "name:latin"], ["get", "name"]];
const FONT_REGULAR = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];

function bandColor(p: Palette): ExpressionSpecification {
  return [
    "match",
    ["get", "band"],
    "fast",
    p.bands.fast,
    "medium",
    p.bands.medium,
    "slow",
    p.bands.slow,
    "critical",
    p.bands.critical,
    p.bands.unknown,
  ];
}

export interface RouteData {
  segments: GeoJSON.FeatureCollection;
  stops: GeoJSON.FeatureCollection;
  pulse: GeoJSON.FeatureCollection;
}

export const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Builds the full map style. Route sources are part of the style so a theme
 * switch (`setStyle` with diffing) keeps the current route on screen.
 */
export function buildStyle(theme: ResolvedTheme, data: RouteData, selectedHop: number | null): StyleSpecification {
  const p = PALETTES[theme];
  const selectedKey = selectedHop === null ? "__none__" : `,${selectedHop},`;
  const isSelected: ExpressionSpecification = ["in", selectedKey, ["get", "hopsKey"]];

  return {
    version: 8,
    // Globe at world scale, flat Web Mercator once the user zooms into a region.
    projection: { type: ["interpolate", ["linear"], ["zoom"], 4.5, "vertical-perspective", 6.5, "mercator"] },
    sky: {
      "sky-color": p.sky,
      "horizon-color": p.horizon,
      "fog-color": p.fog,
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.6,
      "fog-ground-blend": 0.8,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
    },
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
      segments: { type: "geojson", data: data.segments },
      stops: { type: "geojson", data: data.stops },
      pulse: { type: "geojson", data: data.pulse },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": p.land } },
      {
        id: "landcover-wood",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["in", ["get", "class"], ["literal", ["wood", "forest"]]],
        paint: { "fill-color": p.wood, "fill-opacity": 0.7 },
      },
      {
        id: "landcover-ice",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["==", ["get", "class"], "ice"],
        paint: { "fill-color": p.ice, "fill-opacity": 0.8 },
      },
      {
        id: "water",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        paint: { "fill-color": p.ocean },
      },
      {
        id: "waterway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "waterway",
        minzoom: 8,
        paint: { "line-color": p.waterway, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 2] },
      },
      {
        id: "building",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        paint: { "fill-color": p.building, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 15, 1] },
      },
      {
        id: "road-minor",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 10,
        filter: ["in", ["get", "class"], ["literal", ["tertiary", "minor", "service", "street"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": p.roadMinor, "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 10, 0.4, 16, 6] },
      },
      {
        id: "road-major",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 5,
        filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": p.roadMajor, "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 5, 0.4, 16, 9] },
      },
      {
        id: "boundary-state",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        minzoom: 3,
        filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": p.borderState, "line-width": 0.8, "line-dasharray": [2, 2] },
      },
      {
        id: "boundary-country",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": p.border, "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 6, 1.4] },
      },
      {
        id: "road-label",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "transportation_name",
        minzoom: 13,
        layout: {
          "symbol-placement": "line",
          "text-field": NAME,
          "text-font": FONT_REGULAR,
          "text-size": 11,
        },
        paint: { "text-color": p.labelPlace, "text-halo-color": p.halo, "text-halo-width": 1.4 },
      },
      {
        id: "place-city",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 4,
        filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "suburb"]]],
        layout: {
          "text-field": NAME,
          "text-font": FONT_REGULAR,
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 12, 15],
          "symbol-sort-key": ["get", "rank"],
        },
        paint: { "text-color": p.labelPlace, "text-halo-color": p.halo, "text-halo-width": 1.4, "text-opacity": 0.9 },
      },
      {
        id: "place-country",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        maxzoom: 7,
        filter: ["==", ["get", "class"], "country"],
        layout: {
          "text-field": NAME,
          "text-font": FONT_BOLD,
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 9, 6, 14],
          "text-letter-spacing": 0.08,
        },
        paint: { "text-color": p.labelCountry, "text-halo-color": p.halo, "text-halo-width": 1.2, "text-opacity": 0.85 },
      },
      {
        id: "route-glow",
        type: "line",
        source: "segments",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": bandColor(p),
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 7, 10, 14],
          "line-blur": 6,
          "line-opacity": theme === "dark" ? 0.45 : 0.3,
        },
      },
      {
        id: "route-line",
        type: "line",
        source: "segments",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": bandColor(p), "line-width": ["interpolate", ["linear"], ["zoom"], 1, 2, 10, 4] },
      },
      {
        id: "route-pulse",
        type: "circle",
        source: "pulse",
        paint: {
          "circle-radius": 5,
          "circle-color": theme === "dark" ? "#ffffff" : p.bands.medium,
          "circle-blur": 0.4,
          "circle-stroke-width": 6,
          "circle-stroke-color": theme === "dark" ? "rgba(126, 232, 255, 0.35)" : "rgba(31, 99, 224, 0.25)",
        },
      },
      {
        id: "stops-halo",
        type: "circle",
        source: "stops",
        filter: isSelected,
        paint: {
          "circle-radius": 22,
          "circle-color": bandColor(p),
          "circle-opacity": 0.22,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": bandColor(p),
        },
      },
      {
        id: "stops",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": ["case", ["==", ["get", "kind"], "origin"], 9, 11],
          "circle-color": ["case", ["==", ["get", "kind"], "origin"], p.labelPlace, bandColor(p)],
          "circle-stroke-width": 2,
          "circle-stroke-color": p.stopStroke,
        },
      },
      {
        id: "stops-label",
        type: "symbol",
        source: "stops",
        filter: ["==", ["get", "kind"], "hop"],
        layout: {
          "text-field": ["get", "label"],
          "text-font": FONT_BOLD,
          "text-size": 10,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": p.stopText },
      },
    ],
  };
}
