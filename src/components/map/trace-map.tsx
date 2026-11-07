"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { sliceLine, type LngLat, type RouteGeometry } from "@/lib/geo/route";
import { buildStyle, EMPTY, type ResolvedTheme, type RouteData } from "./map-style";

export interface MapFocus {
  coord: LngLat;
  /** Changes on every request so the same stop can be focused twice. */
  nonce: number;
}

interface TraceMapProps {
  theme: ResolvedTheme;
  route: RouteGeometry;
  selectedHop: number | null;
  focus: MapFocus | null;
  /** Extra padding (px) taken by floating UI, so the route is framed in the visible area. */
  padding: { top: number; right: number; bottom: number; left: number };
  onSelectHop(hop: number): void;
}

type Feature = GeoJSON.Feature;
const collection = (features: Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
const point = (coordinates: LngLat): Feature => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates } });

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Draw time for one segment, longer for longer jumps. */
function drawDuration(coords: LngLat[]): number {
  let length = 0;
  for (let i = 1; i < coords.length; i++) {
    length += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
  }
  return Math.min(1800, Math.max(650, 450 + length * 18));
}

function stopFeatures(route: RouteGeometry): Feature[] {
  return route.stops.map((stop) => ({
    type: "Feature",
    properties: {
      id: stop.id,
      kind: stop.kind,
      label: stop.label,
      band: stop.band,
      firstHop: stop.hops[0] ?? null,
      hopsKey: `,${stop.hops.join(",")},`,
    },
    geometry: { type: "Point", coordinates: stop.coord },
  }));
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TraceMap({ theme, route, selectedHop, focus, padding, onSelectHop }: TraceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const dataRef = useRef<RouteData>({ segments: EMPTY, ground: EMPTY, stops: EMPTY, pulse: EMPTY });
  const latest = useRef({ theme, selectedHop, padding, onSelectHop });
  const framedStops = useRef(0);
  /** When each segment (by key) starts drawing, and how long it takes. */
  const schedule = useRef(new Map<string, { start: number; duration: number }>());
  const queueEnd = useRef(0);
  /** Pulse clock survives route updates so the pulse does not restart on every hop. */
  const pulseClock = useRef<number | null>(null);

  useEffect(() => {
    latest.current = { theme, selectedHop, padding, onSelectHop };
  });

  // Create the map once; maplibre is loaded lazily because it needs `window`.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    import("maplibre-gl").then(({ default: maplibregl }) => {
      if (cancelled || !containerRef.current) return;
      const { theme: initialTheme, selectedHop: initialHop } = latest.current;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildStyle(initialTheme, dataRef.current, initialHop),
        center: [-20, 25],
        zoom: 1.4,
        minZoom: 0.8,
        maxPitch: 60,
        attributionControl: { compact: true },
      });
      // Keep the camera centred in the area not covered by the floating panel.
      map.setPadding(latest.current.padding);
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-left");
      map.on("error", (event) => console.error("[map]", event.error?.message ?? event));

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

  // Frame the route while it grows.
  useEffect(() => {
    const map = mapRef.current;
    if (route.stops.length === 0) {
      framedStops.current = 0;
      return;
    }
    if (!map || !route.bounds || route.stops.length === framedStops.current) return;
    framedStops.current = route.stops.length;
    const [[w, s], [e, n]] = route.bounds;
    // Map padding (the panel) is already applied; this is extra breathing room,
    // with more on top so lifted arcs are not clipped.
    const framePadding = { top: 110, right: 60, bottom: 60, left: 60 };
    if (e - w > 90 || n - s > 60) {
      // Intercontinental routes: show the whole globe centred on the route.
      const toRad = Math.PI / 180;
      const x = route.stops.reduce((sum, stop) => sum + Math.cos(stop.coord[0] * toRad), 0);
      const y = route.stops.reduce((sum, stop) => sum + Math.sin(stop.coord[0] * toRad), 0);
      const lat = route.stops.reduce((sum, stop) => sum + stop.coord[1], 0) / route.stops.length;
      map.easeTo({ center: [Math.atan2(y, x) / toRad, Math.max(-50, Math.min(50, lat))], zoom: 1.35, duration: 1600 });
    } else if (route.stops.length === 1 || (e - w < 0.5 && n - s < 0.5)) {
      map.easeTo({ center: route.stops[0].coord, zoom: Math.max(map.getZoom(), 2.2), duration: 1200 });
    } else {
      map.fitBounds(route.bounds, { padding: framePadding, maxZoom: 4.2, duration: 1400 });
    }
  }, [route]);

  // Fly to a stop the user picked in the panel; deep enough to become a flat map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.flyTo({ center: focus.coord, zoom: Math.max(map.getZoom(), 9), speed: 1.2, essential: false });
  }, [focus]);

  /**
   * One animation loop for the route: every new segment draws itself from the
   * previous hop toward the next (queued, so they follow the packet's
   * direction), each stop appears when its segment arrives, and once the
   * route is complete a pulse keeps travelling along it.
   */
  useEffect(() => {
    const reduced = prefersReducedMotion();
    const segments = route.segments.features;
    const grounds = route.ground.features;
    const stops = stopFeatures(route);

    if (segments.length === 0 && stops.length <= 1) {
      schedule.current.clear();
      queueEnd.current = 0;
      pulseClock.current = null;
    }

    const now = performance.now();
    const live = new Set(segments.map((f) => f.properties.key));
    for (const key of schedule.current.keys()) if (!live.has(key)) schedule.current.delete(key);
    for (const feature of segments) {
      const key = feature.properties.key;
      if (schedule.current.has(key)) continue;
      const duration = reduced ? 0 : drawDuration(feature.geometry.coordinates as LngLat[]);
      const start = Math.max(now, queueEnd.current);
      schedule.current.set(key, { start, duration });
      queueEnd.current = start + duration;
    }

    const push = (data: Partial<RouteData>) => {
      dataRef.current = { ...dataRef.current, ...data };
      const map = mapRef.current;
      if (!map) return;
      for (const [id, value] of Object.entries(data)) {
        (map.getSource(id) as GeoJSONSource | undefined)?.setData(value);
      }
    };

    const fullLine = route.line.geometry.coordinates as LngLat[];
    let settled = false;
    let frame = 0;

    const render = (time: number) => {
      const progress = segments.map((f) => {
        const slot = schedule.current.get(f.properties.key)!;
        return slot.duration === 0 ? 1 : Math.min(1, Math.max(0, (time - slot.start) / slot.duration));
      });
      const drawing = progress.some((p) => p < 1);

      if (drawing || !settled) {
        const visibleSegments: Feature[] = [];
        const visibleGround: Feature[] = [];
        const tips: Feature[] = [];
        segments.forEach((f, i) => {
          const p = progress[i];
          if (p <= 0) return;
          const eased = easeInOutCubic(p);
          const arc = sliceLine(f.geometry.coordinates as LngLat[], eased);
          const track = sliceLine(grounds[i].geometry.coordinates as LngLat[], eased);
          visibleSegments.push({ ...f, geometry: { type: "LineString", coordinates: arc } });
          visibleGround.push({ ...grounds[i], geometry: { type: "LineString", coordinates: track } });
          if (p < 1) tips.push(point(arc.at(-1)!));
        });
        // A stop shows once the segment leading to it has arrived.
        const firstStopVisible = stops.slice(0, 1);
        const reachedStops = stops.slice(1).filter((_, i) => progress[i] >= 1);
        push({
          segments: collection(visibleSegments),
          ground: collection(visibleGround),
          stops: collection([...firstStopVisible, ...reachedStops]),
          pulse: collection(tips),
        });
        settled = !drawing;
      }

      if (!drawing && !reduced && fullLine.length > 1) {
        pulseClock.current ??= time;
        const duration = Math.min(9000, Math.max(3000, fullLine.length * 25));
        const t = ((time - pulseClock.current) % duration) / duration;
        const travelled = sliceLine(fullLine, easeInOutCubic(t));
        push({ pulse: collection([point(travelled.at(-1)!)]) });
      } else if (!drawing && settled && (reduced || fullLine.length <= 1)) {
        push({ pulse: EMPTY });
        return;
      }
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [route]);

  return <div ref={containerRef} className="trace-map" role="region" aria-label="Route map" />;
}
