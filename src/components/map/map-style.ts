import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";
import { LATENCY_STOPS, UNKNOWN_LATENCY } from "@/lib/latency-scale";
import { MALVINAS_CAPITAL, PLACE_NAME_OVERRIDES } from "@/lib/place-names";

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
};

export const PALETTES: Record<ResolvedTheme, Palette> = { dark: DARK, light: LIGHT };

const SOURCE_NAME: ExpressionSpecification = ["coalesce", ["get", "name:latin"], ["get", "name"]];
/** Label text, with PLACE_NAME_OVERRIDES applied (e.g. "Islas Malvinas"). */
const NAME: ExpressionSpecification = [
  "case",
  // Only the Stanley tagged with this Spanish name is the Malvinas capital.
  ["==", ["get", "name:es"], MALVINAS_CAPITAL.spanish],
  MALVINAS_CAPITAL.spanish,
  ["match", ["coalesce", ["get", "name:en"], ["get", "name"]], ...Object.entries(PLACE_NAME_OVERRIDES).flat(), SOURCE_NAME],
] as unknown as ExpressionSpecification;
const FONT_REGULAR = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];

/** Continuous round-trip colour (light blue → red) from a feature's `rtt` property. */
function rttColor(theme: ResolvedTheme): ExpressionSpecification {
  const stops = LATENCY_STOPS[theme].flatMap(([ms, color]) => [ms, color]);
  return [
    "case",
    ["==", ["typeof", ["get", "rtt"]], "number"],
    ["interpolate", ["linear"], ["get", "rtt"], ...stops] as ExpressionSpecification,
    UNKNOWN_LATENCY[theme],
  ];
}

export interface RouteData {
  segments: GeoJSON.FeatureCollection;
  /** Hop pins (clustered). */
  stops: GeoJSON.FeatureCollection;
  origin: GeoJSON.FeatureCollection;
}

/** Pins closer than this (px) merge into a cluster until CLUSTER_MAX_ZOOM. */
export const CLUSTER_RADIUS = 34;
export const CLUSTER_MAX_ZOOM = 8;

/** "4" or "4–9": the hop range a cluster holds. */
const CLUSTER_LABEL: ExpressionSpecification = [
  "case",
  ["==", ["get", "minHop"], ["get", "maxHop"]],
  ["to-string", ["get", "minHop"]],
  ["concat", ["to-string", ["get", "minHop"]], "–", ["to-string", ["get", "maxHop"]]],
];

/** Circle radius that grows with its label so "3–5, 9" still fits inside. */
const fitRadius = (label: ExpressionSpecification, min: number): ExpressionSpecification => [
  "max",
  min,
  ["+", 5, ["*", 3.3, ["length", label]]],
];

/** Dark text on light (fast/amber) colours, white text on the slow reds. */
function pinTextColor(rttExpr: ExpressionSpecification): ExpressionSpecification {
  return ["case", [">=", ["coalesce", rttExpr, 0], 180], "#ffffff", "#06122b"];
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
    // Globe at world scale that flattens into Web Mercator at street level.
    // deck.gl's overlay (3D arcs) only understands the built-in "globe" projection.
    projection: { type: "globe" },
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
      stops: {
        type: "geojson",
        data: data.stops,
        cluster: true,
        clusterRadius: CLUSTER_RADIUS,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterProperties: {
          minHop: ["min", ["get", "firstHop"]],
          maxHop: ["max", ["get", "lastHop"]],
          maxRtt: ["max", ["coalesce", ["get", "rtt"], 0]],
        },
      },
      origin: { type: "geojson", data: data.origin },
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
        filter: [
          "all",
          ["==", ["get", "admin_level"], 2],
          ["!=", ["get", "maritime"], 1],
          ["!=", ["get", "disputed"], 1],
        ],
        paint: { "line-color": p.border, "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 6, 1.4] },
      },
      {
        // Disputed country borders (e.g. around the Malvinas) are dashed, not drawn as settled borders.
        id: "boundary-disputed",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["==", ["get", "disputed"], 1]],
        paint: {
          "line-color": p.border,
          "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 6, 1.4],
          "line-dasharray": [3, 2],
        },
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
        // Shadow of each 3D jump on the surface; it gives the arc its height.
        id: "route-ground",
        type: "line",
        source: "segments",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": rttColor(theme),
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1, 10, 2],
          "line-dasharray": [1.5, 2.5],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 6, theme === "dark" ? 0.4 : 0.5, 8, 0],
        },
      },
      {
        // Up close the arcs fade out (see trace-map) and the route lies flat on the map.
        id: "route-line",
        type: "line",
        source: "segments",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": rttColor(theme),
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2, 14, 5],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 6.5, 0, 8.5, 1],
        },
      },
      {
        id: "origin",
        type: "circle",
        source: "origin",
        paint: {
          "circle-radius": 7,
          "circle-color": p.labelPlace,
          "circle-stroke-width": 3,
          "circle-stroke-color": p.stopStroke,
        },
      },
      {
        // A group of nearby pins, labelled with the hops it holds (e.g. "4–9").
        id: "stop-clusters",
        type: "circle",
        source: "stops",
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": fitRadius(CLUSTER_LABEL, 15),
          "circle-color": ["interpolate", ["linear"], ["get", "maxRtt"], ...LATENCY_STOPS[theme].flatMap(([ms, color]) => [ms, color])] as ExpressionSpecification,
          "circle-stroke-width": 4,
          "circle-stroke-color": ["interpolate", ["linear"], ["get", "maxRtt"], ...LATENCY_STOPS[theme].flatMap(([ms, color]) => [ms, color])] as ExpressionSpecification,
          "circle-stroke-opacity": 0.35,
        },
      },
      {
        id: "stop-clusters-label",
        type: "symbol",
        source: "stops",
        filter: ["has", "point_count"],
        layout: {
          "text-field": CLUSTER_LABEL,
          "text-font": FONT_BOLD,
          "text-size": 11,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": pinTextColor(["get", "maxRtt"]) },
      },
      {
        id: "stops-halo",
        type: "circle",
        source: "stops",
        filter: ["all", ["!", ["has", "point_count"]], isSelected],
        paint: {
          "circle-radius": ["+", 9, fitRadius(["get", "label"], 12)],
          "circle-color": rttColor(theme),
          "circle-opacity": 0.2,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": rttColor(theme),
        },
      },
      {
        id: "stops",
        type: "circle",
        source: "stops",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": fitRadius(["get", "label"], 12),
          "circle-color": rttColor(theme),
          "circle-stroke-width": 2,
          "circle-stroke-color": p.stopStroke,
        },
      },
      {
        // The pin number is the hop's position in the route.
        id: "stops-label",
        type: "symbol",
        source: "stops",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["get", "label"],
          "text-font": FONT_BOLD,
          "text-size": 11,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": pinTextColor(["get", "rtt"]) },
      },
    ],
  };
}
