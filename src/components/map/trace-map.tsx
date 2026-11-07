"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { LngLat, RouteGeometry } from "@/lib/geo/route";
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

function toStopsData(route: RouteGeometry): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: route.stops.map((stop) => ({
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
    })),
  };
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TraceMap({ theme, route, selectedHop, focus, padding, onSelectHop }: TraceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const dataRef = useRef<RouteData>({ segments: EMPTY, stops: EMPTY, pulse: EMPTY });
  const latest = useRef({ theme, selectedHop, padding, onSelectHop });
  const framedStops = useRef(0);

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

  // Route updates: push new data and frame the route while it grows.
  useEffect(() => {
    const stops = toStopsData(route);
    dataRef.current = { ...dataRef.current, segments: route.segments, stops };
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      (map.getSource("segments") as GeoJSONSource | undefined)?.setData(route.segments);
      (map.getSource("stops") as GeoJSONSource | undefined)?.setData(stops);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);

    if (route.stops.length === 0) {
      framedStops.current = 0;
      return;
    }
    if (route.bounds && route.stops.length !== framedStops.current) {
      framedStops.current = route.stops.length;
      const [[w, s], [e, n]] = route.bounds;
      // Map padding (the panel) is already applied; this is extra breathing room.
      const framePadding = 60;
      if (route.stops.length === 1 || (e - w < 0.5 && n - s < 0.5)) {
        map.easeTo({ center: route.stops[0].coord, zoom: Math.max(map.getZoom(), 2.2), duration: 1200 });
      } else {
        map.fitBounds(route.bounds, { padding: framePadding, maxZoom: 4.2, duration: 1400 });
      }
    }
  }, [route]);

  // Fly to a stop the user picked in the panel; deep enough to become a flat map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.flyTo({
      center: focus.coord,
      zoom: Math.max(map.getZoom(), 9),
      speed: 1.2,
      essential: false,
    });
  }, [focus]);

  // Signal pulse travelling along the route.
  useEffect(() => {
    const coords = route.line.geometry.coordinates;
    const setPulse = (data: GeoJSON.FeatureCollection) => {
      dataRef.current = { ...dataRef.current, pulse: data };
      (mapRef.current?.getSource("pulse") as GeoJSONSource | undefined)?.setData(data);
    };
    if (coords.length < 2 || prefersReducedMotion()) {
      setPulse(EMPTY);
      return;
    }

    const cumulative = [0];
    for (let i = 1; i < coords.length; i++) {
      const [x1, y1] = coords[i - 1];
      const [x2, y2] = coords[i];
      cumulative.push(cumulative[i - 1] + Math.hypot(x2 - x1, y2 - y1));
    }
    const total = cumulative.at(-1)!;
    const duration = Math.min(9000, Math.max(3000, total * 40));
    let frame = 0;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const t = ((now - startedAt) % duration) / duration;
      const target = t * total;
      let i = cumulative.findIndex((d) => d >= target);
      if (i <= 0) i = 1;
      const span = cumulative[i] - cumulative[i - 1] || 1;
      const k = (target - cumulative[i - 1]) / span;
      const [x1, y1] = coords[i - 1];
      const [x2, y2] = coords[i];
      setPulse({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [x1 + (x2 - x1) * k, y1 + (y2 - y1) * k] } },
        ],
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [route]);

  return <div ref={containerRef} className="trace-map" role="region" aria-label="Route map" />;
}
