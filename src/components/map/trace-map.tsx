"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { MapboxOverlay } from "@deck.gl/mapbox";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { sliceLine, zoomForSpan, type Arc3D, type LngLat, type Position3, type RouteGeometry } from "@/lib/geo/route";
import { latencyRgba } from "@/lib/latency-scale";
import { buildStyle, EMPTY, type ResolvedTheme, type RouteData } from "./map-style";

export interface MapFocus {
  coord: LngLat;
  /** Changes on every request so the same stop can be focused twice. */
  nonce: number;
}

interface TraceMapProps {
  theme: ResolvedTheme;
  route: RouteGeometry;
  /** True once the trace has ended; the camera then frames the whole route. */
  finished: boolean;
  selectedHop: number | null;
  focus: MapFocus | null;
  /** Extra padding (px) taken by floating UI, so the route is framed in the visible area. */
  padding: { top: number; right: number; bottom: number; left: number };
  onSelectHop(hop: number): void;
}

// Start downloading maplibre as soon as this module loads, in parallel with hydration.
const maplibrePromise = typeof window === "undefined" ? null : import("maplibre-gl");

type DeckModules = {
  MapboxOverlay: typeof import("@deck.gl/mapbox").MapboxOverlay;
  PathLayer: typeof import("@deck.gl/layers").PathLayer;
  ScatterplotLayer: typeof import("@deck.gl/layers").ScatterplotLayer;
};
let deckPromise: Promise<DeckModules | null> | null = null;
/**
 * deck.gl (3D arcs) is only fetched once the first segment exists, keeping
 * first load light. A failed download resolves to null (the map keeps working
 * with its flat lines) and is retried on the next call.
 */
function loadDeck(): Promise<DeckModules | null> {
  deckPromise ??= Promise.all([import("@deck.gl/mapbox"), import("@deck.gl/layers")])
    .then(([mapbox, layers]) => ({
      MapboxOverlay: mapbox.MapboxOverlay,
      PathLayer: layers.PathLayer,
      ScatterplotLayer: layers.ScatterplotLayer,
    }))
    .catch((error) => {
      console.error("[map] 3D arcs unavailable:", error);
      deckPromise = null;
      return null;
    });
  return deckPromise;
}

type Feature = GeoJSON.Feature;
const collection = (features: Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Slow, length-aware draw time so the line visibly grows hop by hop. */
const drawDuration = (km: number) => Math.min(5000, Math.max(1600, 1500 + km * 0.3));

/**
 * Camera tilt while following a segment, so altitude reads as height. Kept
 * low when zoomed far out, where a strong tilt pushes the globe off screen.
 */
const followPitch = (zoom: number) => Math.min(50, Math.max(12, 12 + (zoom - 1.5) * 13));

/** Arcs fade out as the globe flattens into a street map; the flat line takes over. */
const arcOpacity = (zoom: number) => Math.max(0, Math.min(1, 1 - (zoom - 7) / 2));

/** First guess of where the viewer is, from the time zone offset: instant and offline. */
function initialCenter(): LngLat {
  if (typeof window === "undefined") return [10, 30];
  const lon = -new Date().getTimezoneOffset() / 4;
  return [Math.max(-170, Math.min(170, lon)), 28];
}

function stopFeatures(route: RouteGeometry): Feature[] {
  return route.stops.map((stop) => ({
    type: "Feature",
    properties: {
      id: stop.id,
      kind: stop.kind,
      label: stop.label,
      rtt: stop.rtt,
      firstHop: stop.hops[0] ?? null,
      hopsKey: `,${stop.hops.join(",")},`,
    },
    geometry: { type: "Point", coordinates: stop.coord },
  }));
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface DrawnArc {
  key: string;
  path: Position3[];
  colors: [number, number, number, number][];
}

/** Per-vertex colours so each arc fades from its start RTT colour to its end RTT colour. */
function colorize(arc: Arc3D, path: Position3[], theme: ResolvedTheme, alpha: number): DrawnArc {
  const total = arc.path.length - 1 || 1;
  const colors = path.map((_, i) => {
    const t = Math.min(1, i / total);
    const from = arc.fromRtt;
    const to = arc.rtt;
    const rtt = from === null || to === null ? (to ?? from) : from + (to - from) * t;
    return latencyRgba(rtt, theme, alpha);
  });
  return { key: arc.key, path, colors };
}

export function TraceMap({ theme, route, finished, selectedHop, focus, padding, onSelectHop }: TraceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const deckRef = useRef<DeckModules | null>(null);
  const dataRef = useRef<RouteData>({ segments: EMPTY, stops: EMPTY });
  const latest = useRef({ theme, selectedHop, padding, onSelectHop, finished });
  /** When each segment (by key) starts drawing, and how long it takes. */
  const schedule = useRef(new Map<string, { start: number; duration: number }>());
  const queueEnd = useRef(0);
  const pulseClock = useRef<number | null>(null);
  /** The user moved the map: stop driving the camera until the next trace. */
  const followPaused = useRef(false);
  const framedWhole = useRef(false);

  useEffect(() => {
    latest.current = { theme, selectedHop, padding, onSelectHop, finished };
  });

  // Create the map once; maplibre is loaded lazily because it needs `window`.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    maplibrePromise?.then(({ default: maplibregl }) => {
      if (cancelled || !containerRef.current) return;
      const { theme: initialTheme, selectedHop: initialHop } = latest.current;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildStyle(initialTheme, dataRef.current, initialHop),
        center: initialCenter(),
        zoom: 2.3,
        minZoom: 1,
        maxPitch: 60,
        fadeDuration: 150,
        attributionControl: { compact: true },
      });
      // Keep the camera centred in the area not covered by the floating panel.
      map.setPadding(latest.current.padding);
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-left");
      map.on("error", (event) => console.error("[map]", event.error?.message ?? event));
      // Any gesture from the user takes over the camera.
      map.on("movestart", (event) => {
        if ((event as { originalEvent?: Event }).originalEvent) followPaused.current = true;
      });

      map.on("click", "stops", (e) => {
        const hop = e.features?.[0]?.properties?.firstHop;
        if (typeof hop === "number") latest.current.onSelectHop(hop);
      });
      map.on("mouseenter", "stops", () => map && (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "stops", () => map && (map.getCanvas().style.cursor = ""));
      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      overlayRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    mapRef.current?.setPadding(padding);
  }, [padding]);

  // Theme or selection change: diff the whole style, keeping current route data.
  useEffect(() => {
    mapRef.current?.setStyle(buildStyle(theme, dataRef.current, selectedHop), { diff: true });
  }, [theme, selectedHop]);

  // Fly to a stop the user picked in the panel; deep enough to become a flat map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    followPaused.current = true;
    map.flyTo({ center: focus.coord, zoom: Math.max(map.getZoom(), 9), speed: 1.2, essential: false });
  }, [focus]);

  /**
   * One animation loop for the route. Every new segment draws itself slowly
   * from the previous hop toward the next as a 3D arc (queued, so they follow
   * the packet's direction) while the camera follows the tip; each stop shows
   * when its segment arrives; afterwards a pulse keeps travelling the route.
   */
  useEffect(() => {
    const reduced = prefersReducedMotion();
    const arcs = route.arcs;
    const segments = route.segments.features;
    const stops = stopFeatures(route);

    if (arcs.length === 0 && stops.length <= 1) {
      schedule.current.clear();
      queueEnd.current = 0;
      pulseClock.current = null;
      followPaused.current = false;
      framedWhole.current = false;
    }
    // "failed" lets the loop go idle instead of waiting forever for deck.gl.
    let deckState: "loading" | "ready" | "failed" = deckRef.current ? "ready" : "loading";
    if (arcs.length > 0 && !deckRef.current) {
      void loadDeck().then((modules) => {
        deckRef.current = modules;
        deckState = modules ? "ready" : "failed";
      });
    }

    const now = performance.now();
    const live = new Set(arcs.map((a) => a.key));
    for (const key of schedule.current.keys()) if (!live.has(key)) schedule.current.delete(key);
    for (const arc of arcs) {
      if (schedule.current.has(arc.key)) continue;
      const duration = reduced ? 0 : drawDuration(arc.km);
      const start = Math.max(now, queueEnd.current);
      schedule.current.set(arc.key, { start, duration });
      queueEnd.current = start + duration;
      framedWhole.current = false;
    }

    const fullPath: Position3[] = arcs.flatMap((arc, i) => (i === 0 ? arc.path : arc.path.slice(1)));

    const pushMapData = (data: RouteData) => {
      dataRef.current = data;
      const map = mapRef.current;
      if (!map) return;
      (map.getSource("segments") as GeoJSONSource | undefined)?.setData(data.segments);
      (map.getSource("stops") as GeoJSONSource | undefined)?.setData(data.stops);
    };

    const ensureOverlay = () => {
      const map = mapRef.current;
      const deck = deckRef.current;
      if (!map || !deck) return null;
      if (!overlayRef.current) {
        overlayRef.current = new deck.MapboxOverlay({ interleaved: true, layers: [] });
        map.addControl(overlayRef.current);
      }
      return overlayRef.current;
    };

    const follow = (tip: LngLat, km: number) => {
      const map = mapRef.current;
      if (!map || reduced || followPaused.current) return;
      const center = map.getCenter();
      const dLon = ((tip[0] - center.lng + 540) % 360) - 180;
      const zoom = map.getZoom();
      const nextZoom = zoom + (zoomForSpan(km) - zoom) * 0.04;
      const pitch = map.getPitch();
      map.jumpTo({
        center: [center.lng + dLon * 0.07, center.lat + (tip[1] - center.lat) * 0.07],
        zoom: nextZoom,
        // Tilt the camera so the arcs visibly rise off the globe.
        pitch: pitch + (followPitch(nextZoom) - pitch) * 0.05,
      });
    };

    const frameWholeRoute = () => {
      const map = mapRef.current;
      if (!map || !route.bounds || followPaused.current || framedWhole.current) return;
      framedWhole.current = true;
      const [[w, s], [e, n]] = route.bounds;
      if (e - w > 90 || n - s > 60) {
        const toRad = Math.PI / 180;
        const x = route.stops.reduce((sum, stop) => sum + Math.cos(stop.coord[0] * toRad), 0);
        const y = route.stops.reduce((sum, stop) => sum + Math.sin(stop.coord[0] * toRad), 0);
        const lat = route.stops.reduce((sum, stop) => sum + stop.coord[1], 0) / route.stops.length;
        map.easeTo({ center: [Math.atan2(y, x) / toRad, Math.max(-50, Math.min(50, lat))], zoom: 1.6, pitch: followPitch(1.6), duration: 2000 });
      } else if (e - w > 0.5 || n - s > 0.5) {
        map.fitBounds(route.bounds, { padding: { top: 120, right: 60, bottom: 60, left: 60 }, maxZoom: 5, pitch: 40, duration: 2000 });
      }
    };

    let frame = 0;
    let settled = false;

    const render = (time: number) => {
      const map = mapRef.current;
      const progress = arcs.map((arc) => {
        const slot = schedule.current.get(arc.key)!;
        return slot.duration === 0 ? 1 : Math.min(1, Math.max(0, (time - slot.start) / slot.duration));
      });
      const drawingIndex = progress.findIndex((p) => p > 0 && p < 1);
      const drawing = progress.some((p) => p < 1);
      const currentTheme = latest.current.theme;

      // Ground tracks and stops (MapLibre), revealed in step with the arcs.
      if (drawing || !settled) {
        const visibleSegments: Feature[] = [];
        segments.forEach((f, i) => {
          if (progress[i] <= 0) return;
          const track = sliceLine(f.geometry.coordinates as LngLat[], easeInOutCubic(progress[i]));
          visibleSegments.push({ ...f, geometry: { type: "LineString", coordinates: track } });
        });
        const reached = stops.slice(1).filter((_, i) => progress[i] >= 1);
        pushMapData({ segments: collection(visibleSegments), stops: collection([...stops.slice(0, 1), ...reached]) });
        settled = !drawing;
      }

      // 3D arcs, glow and pulse (deck.gl).
      const overlay = ensureOverlay();
      const deck = deckRef.current;
      if (overlay && deck && map) {
        const opacity = arcOpacity(map.getZoom());
        const drawn: DrawnArc[] = [];
        const glow: DrawnArc[] = [];
        let tip: Position3 | null = null;
        arcs.forEach((arc, i) => {
          if (progress[i] <= 0) return;
          const path = sliceLine(arc.path, easeInOutCubic(progress[i]));
          drawn.push(colorize(arc, path, currentTheme, 255));
          glow.push(colorize(arc, path, currentTheme, currentTheme === "dark" ? 70 : 55));
          if (i === drawingIndex) tip = path.at(-1)!;
        });

        let pulse: Position3 | null = tip;
        if (!drawing && !reduced && fullPath.length > 1) {
          pulseClock.current ??= time;
          const period = Math.min(10_000, Math.max(3500, fullPath.length * 30));
          const t = ((time - pulseClock.current) % period) / period;
          pulse = sliceLine(fullPath, easeInOutCubic(t)).at(-1)!;
        }

        overlay.setProps({
          layers: [
            new deck.PathLayer<DrawnArc>({
              id: "arc-glow",
              data: glow,
              getPath: (d) => d.path,
              getColor: (d) => d.colors,
              getWidth: 9,
              widthUnits: "pixels",
              capRounded: true,
              jointRounded: true,
              billboard: true,
              opacity,
              updateTriggers: { getPath: time, getColor: time },
            }),
            new deck.PathLayer<DrawnArc>({
              id: "arc-line",
              data: drawn,
              getPath: (d) => d.path,
              getColor: (d) => d.colors,
              getWidth: 2.5,
              widthUnits: "pixels",
              capRounded: true,
              jointRounded: true,
              billboard: true,
              opacity,
              updateTriggers: { getPath: time, getColor: time },
            }),
            new deck.ScatterplotLayer<Position3>({
              id: "arc-pulse",
              data: pulse ? [pulse] : [],
              getPosition: (d) => d,
              getRadius: 5,
              radiusUnits: "pixels",
              getFillColor: currentTheme === "dark" ? [255, 255, 255, 255] : [23, 71, 181, 255],
              stroked: true,
              getLineColor: currentTheme === "dark" ? [126, 232, 255, 110] : [23, 71, 181, 70],
              getLineWidth: 6,
              lineWidthUnits: "pixels",
              opacity,
              updateTriggers: { getPosition: time },
            }),
          ],
        });
      }

      if (drawingIndex >= 0) {
        const track = segments[drawingIndex].geometry.coordinates as LngLat[];
        follow(sliceLine(track, easeInOutCubic(progress[drawingIndex])).at(-1)!, arcs[drawingIndex].km);
      } else if (!drawing && latest.current.finished) {
        frameWholeRoute();
      }

      // Keep ticking while drawing, pulsing, or waiting for deck.gl to arrive.
      const waitingForDeck = arcs.length > 0 && deckState === "loading";
      const idle = !drawing && settled && (reduced || fullPath.length <= 1) && !waitingForDeck;
      frame = idle ? 0 : requestAnimationFrame(render);
    };

    // Once idle, zooming must still repaint the arcs (their opacity depends on zoom).
    const repaint = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    const map = mapRef.current;
    map?.on("zoom", repaint);
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      map?.off("zoom", repaint);
    };
    // `theme` restarts the loop so idle arcs repaint in the new palette.
  }, [route, finished, theme]);

  return <div ref={containerRef} className="trace-map" role="region" aria-label="Route map" />;
}
