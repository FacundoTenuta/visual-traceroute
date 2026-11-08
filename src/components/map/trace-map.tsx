"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { MapboxOverlay } from "@deck.gl/mapbox";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { formatMs } from "@/lib/format";
import type { ProbeLocation } from "@/lib/globalping/catalog";
import { sliceLine, zoomForSpan, type LngLat, type Position3, type RouteGeometry, type RouteStop } from "@/lib/geo/route";
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
  /** Changes when the user asks to replay the route animation from the start. */
  replay: number;
  selectedHop: number | null;
  focus: MapFocus | null;
  /** Extra padding (px) taken by floating UI, so the route is framed in the visible area. */
  padding: { top: number; right: number; bottom: number; left: number };
  onSelectHop(hop: number): void;
  /** Cities with probes (pickable trace origins) and the chosen one. */
  probeLocations: ProbeLocation[];
  selectedOrigin: string | null;
  onPickOrigin(locationId: string): void;
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

/** Lowest pin layer in the map style; deck.gl layers are inserted right below it. */
const PINS_BOTTOM_LAYER = "origin";
/**
 * @deck.gl/mapbox reads `beforeId` from layer props in interleaved mode, but its
 * `LayerOverlayProps` type is not exported, so it is passed through a spread.
 */
const UNDER_PINS = { beforeId: PINS_BOTTOM_LAYER };

/** Arcs fade out as the globe flattens into a street map; the flat line takes over. */
const arcOpacity = (zoom: number) => Math.max(0, Math.min(1, 1 - (zoom - 7) / 2));

/** First guess of where the viewer is, from the time zone offset: instant and offline. */
function initialCenter(): LngLat {
  if (typeof window === "undefined") return [10, 30];
  const lon = -new Date().getTimezoneOffset() / 4;
  return [Math.max(-170, Math.min(170, lon)), 28];
}

function stopFeature(stop: RouteStop): Feature {
  return {
    type: "Feature",
    properties: {
      id: stop.id,
      kind: stop.kind,
      label: stop.label,
      rtt: stop.rtt,
      city: stop.city,
      countryCode: stop.countryCode,
      firstHop: stop.hops[0] ?? null,
      lastHop: stop.hops.at(-1) ?? null,
      hopsKey: `,${stop.hops.join(",")},`,
    },
    geometry: { type: "Point", coordinates: stop.coord },
  };
}

/** Tooltip for a pin, built from DOM nodes (provider strings are never parsed as HTML). */
function pinTooltip(props: Record<string, unknown>): HTMLElement {
  const root = document.createElement("div");
  root.className = "pin-tip";
  const title = document.createElement("strong");
  const label = String(props.label ?? "");
  title.textContent = `${label.includes(",") || label.includes("–") ? "Hops" : "Hop"} ${label}`;
  root.append(title);
  const place = [props.city, props.countryCode].filter((v) => typeof v === "string" && v).join(", ");
  if (place) root.append(Object.assign(document.createElement("span"), { textContent: place }));
  if (typeof props.rtt === "number") {
    root.append(Object.assign(document.createElement("span"), { textContent: `${formatMs(props.rtt)} round trip` }));
  }
  return root;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Rgba = [number, number, number, number];

interface DrawnArc {
  key: string;
  path: Position3[];
  /** One colour per segment: the RTT of the hop it arrives at. */
  color: Rgba;
}

interface Pulse {
  position: Position3;
  color: Rgba;
}

export function TraceMap({
  theme,
  route,
  finished,
  replay,
  selectedHop,
  focus,
  padding,
  onSelectHop,
  probeLocations,
  selectedOrigin,
  onPickOrigin,
}: TraceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const deckRef = useRef<DeckModules | null>(null);
  const dataRef = useRef<RouteData>({ segments: EMPTY, stops: EMPTY, origin: EMPTY, probes: EMPTY });
  const latest = useRef({ theme, selectedHop, padding, onSelectHop, finished, selectedOrigin, onPickOrigin });
  /** When each segment (by key) starts drawing, and how long it takes. */
  const schedule = useRef(new Map<string, { start: number; duration: number }>());
  const queueEnd = useRef(0);
  const pulseClock = useRef<number | null>(null);
  /** The user moved the map: stop driving the camera until the next trace. */
  const followPaused = useRef(false);
  const framedWhole = useRef(false);
  const replayed = useRef(replay);

  useEffect(() => {
    latest.current = { theme, selectedHop, padding, onSelectHop, finished, selectedOrigin, onPickOrigin };
  });

  // Create the map once; maplibre is loaded lazily because it needs `window`.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    maplibrePromise?.then(({ default: maplibregl }) => {
      if (cancelled || !containerRef.current) return;
      const { theme: initialTheme, selectedHop: initialHop, selectedOrigin: initialOrigin } = latest.current;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildStyle(initialTheme, dataRef.current, initialHop, initialOrigin),
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
      // A cluster opens up: zoom in until its pins separate.
      map.on("click", "stop-clusters", async (e) => {
        const feature = e.features?.[0];
        const source = map?.getSource("stops") as GeoJSONSource | undefined;
        if (!map || !feature || !source || feature.geometry.type !== "Point") return;
        followPaused.current = true;
        const zoom = await source.getClusterExpansionZoom(feature.properties?.cluster_id);
        map.easeTo({ center: feature.geometry.coordinates as LngLat, zoom: zoom + 0.3, pitch: 0, duration: 800 });
      });
      const tooltip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 16, className: "pin-popup" });
      for (const layer of ["stops", "stop-clusters"]) {
        map.on("mouseenter", layer, () => map && (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => {
          if (map) map.getCanvas().style.cursor = "";
          tooltip.remove();
        });
      }
      // Probe cities: hover to see where a trace would start, click to pick it.
      map.on("click", "probes", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") latest.current.onPickOrigin(id);
      });
      map.on("mouseenter", "probes", () => map && (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "probes", () => {
        if (map) map.getCanvas().style.cursor = "";
        tooltip.remove();
      });
      map.on("mousemove", "probes", (e) => {
        const feature = e.features?.[0];
        if (!map || !feature || feature.geometry.type !== "Point") return;
        const p = feature.properties ?? {};
        const root = Object.assign(document.createElement("div"), { className: "pin-tip" });
        root.append(Object.assign(document.createElement("strong"), { textContent: `Trace from ${p.label}` }));
        root.append(Object.assign(document.createElement("span"), { textContent: `${p.probes} probe${p.probes === 1 ? "" : "s"} · ${p.network}` }));
        tooltip.setLngLat(feature.geometry.coordinates as LngLat).setDOMContent(root).addTo(map);
      });
      map.on("mousemove", "stops", (e) => {
        const feature = e.features?.[0];
        if (!map || !feature || feature.geometry.type !== "Point") return;
        tooltip
          .setLngLat(feature.geometry.coordinates as LngLat)
          .setDOMContent(pinTooltip(feature.properties ?? {}))
          .addTo(map);
      });
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
    mapRef.current?.setStyle(buildStyle(theme, dataRef.current, selectedHop, selectedOrigin), { diff: true });
  }, [theme, selectedHop, selectedOrigin]);

  // Picking a trace origin turns the globe to it, unless a route is on screen.
  useEffect(() => {
    const map = mapRef.current;
    const location = probeLocations.find((l) => l.id === selectedOrigin);
    if (!map || !location || route.stops.length > 0) return;
    map.easeTo({ center: [location.lon, location.lat], zoom: Math.max(map.getZoom(), 2.6), pitch: 0, duration: 1200 });
    // Only react to a new choice, not to route or list updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrigin]);

  // Probe cities change rarely (once loaded); push them on their own.
  useEffect(() => {
    const probes: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: probeLocations.map((l) => ({
        type: "Feature",
        properties: { id: l.id, label: `${l.city}, ${l.country}`, probes: l.probes, network: l.networks[0]?.network ?? "" },
        geometry: { type: "Point", coordinates: [l.lon, l.lat] },
      })),
    };
    dataRef.current = { ...dataRef.current, probes };
    const map = mapRef.current;
    const apply = () => (map?.getSource("probes") as GeoJSONSource | undefined)?.setData(probes);
    if (!map) return;
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [probeLocations]);

  // Fly to a stop the user picked in the panel, straight down, at city level.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    followPaused.current = true;
    map.flyTo({ center: focus.coord, zoom: Math.max(map.getZoom(), 9), pitch: 0, speed: 1.2, essential: false });
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
    const originFeatures = route.stops.filter((s) => s.kind === "origin").map(stopFeature);
    const hopStops = route.stops.filter((s) => s.kind === "hop");
    const hopFeatures = new Map(hopStops.map((s) => [s.id, stopFeature(s)]));
    // The first place shows right away; every other one when a segment reaches it.
    const firstHopStop = arcs[0]?.from ?? hopStops[0]?.id;

    // A new trace, or "Replay route": forget what was drawn so every segment
    // draws again in order and the camera follows from the start.
    const replaying = replay !== replayed.current;
    replayed.current = replay;
    if (replaying || (arcs.length === 0 && hopStops.length <= 1)) {
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
    // Index of the last vertex of each arc inside fullPath, to colour the pulse.
    const arcEnds: number[] = [];
    arcs.reduce((end, arc) => {
      const next = end + arc.path.length - 1;
      arcEnds.push(next);
      return next;
    }, 0);

    let pinsKey = "";
    const pushMapData = (data: Omit<RouteData, "probes">, key: string) => {
      const map = mapRef.current;
      dataRef.current = { ...dataRef.current, ...data };
      if (!map) return;
      (map.getSource("segments") as GeoJSONSource | undefined)?.setData(data.segments);
      // Pins only change when one is reached: re-clustering every frame would flicker.
      if (key !== pinsKey) {
        pinsKey = key;
        (map.getSource("stops") as GeoJSONSource | undefined)?.setData(data.stops);
        (map.getSource("origin") as GeoJSONSource | undefined)?.setData(data.origin);
      }
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
      const pitch = map.getPitch();
      map.jumpTo({
        center: [center.lng + dLon * 0.07, center.lat + (tip[1] - center.lat) * 0.07],
        zoom: zoom + (zoomForSpan(km) - zoom) * 0.04,
        // Automatic moves look straight down; tilting to see the 3D arcs is up to the user.
        pitch: pitch * 0.9,
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
        map.easeTo({ center: [Math.atan2(y, x) / toRad, Math.max(-50, Math.min(50, lat))], zoom: 1.6, pitch: 0, duration: 2000 });
      } else if (e - w > 0.5 || n - s > 0.5) {
        map.fitBounds(route.bounds, { padding: { top: 120, right: 60, bottom: 60, left: 60 }, maxZoom: 5, pitch: 0, duration: 2000 });
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
        const visible = new Set<string>(firstHopStop ? [firstHopStop] : []);
        arcs.forEach((arc, i) => {
          if (progress[i] >= 1) visible.add(arc.to);
        });
        const pins = [...hopFeatures].filter(([id]) => visible.has(id)).map(([, f]) => f);
        pushMapData(
          { segments: collection(visibleSegments), stops: collection(pins), origin: collection(originFeatures) },
          `${[...visible].sort().join("|")}#${originFeatures.length}#${route.stops.map((s) => s.label).join("|")}`,
        );
        settled = !drawing;
      }

      // 3D arcs and pulse (deck.gl).
      const overlay = ensureOverlay();
      const deck = deckRef.current;
      if (overlay && deck && map) {
        const opacity = arcOpacity(map.getZoom());
        const drawn: DrawnArc[] = [];
        let pulse: Pulse | null = null;
        arcs.forEach((arc, i) => {
          if (progress[i] <= 0) return;
          const path = sliceLine(arc.path, easeInOutCubic(progress[i]));
          const color = latencyRgba(arc.rtt, currentTheme);
          if (path.length > 1) drawn.push({ key: arc.key, path, color });
          if (i === drawingIndex) pulse = { position: path.at(-1)!, color };
        });

        if (!drawing && !reduced && fullPath.length > 1) {
          pulseClock.current ??= time;
          const period = Math.min(10_000, Math.max(3500, fullPath.length * 30));
          const t = ((time - pulseClock.current) % period) / period;
          const travelled = sliceLine(fullPath, easeInOutCubic(t));
          // The pulse takes the colour of the segment it is on.
          const vertex = travelled.length - 1;
          const arcIndex = arcEnds.findIndex((end) => vertex <= end);
          pulse = { position: travelled.at(-1)!, color: latencyRgba(arcs[Math.max(0, arcIndex)].rtt, currentTheme) };
        }

        overlay.setProps({
          layers: [
            new deck.PathLayer<DrawnArc>({
              id: "arc-line",
              // Draw under every pin layer so hop numbers are never covered by lines.
              ...UNDER_PINS,
              data: drawn,
              getPath: (d) => d.path,
              getColor: (d) => d.color,
              getWidth: 2,
              widthUnits: "pixels",
              capRounded: true,
              jointRounded: true,
              billboard: true,
              // Test against the globe (arcs hide behind it) but don't write depth, so
              // overlapping arcs blend in order instead of z-fighting into stripes.
              parameters: { depthWriteEnabled: false },
              opacity,
              updateTriggers: { getPath: time, getColor: time },
            }),
            new deck.ScatterplotLayer<Pulse>({
              id: "arc-pulse",
              ...UNDER_PINS,
              data: pulse ? [pulse] : [],
              getPosition: (d) => d.position,
              getRadius: 4,
              radiusUnits: "pixels",
              getFillColor: (d) => d.color,
              stroked: true,
              getLineColor: currentTheme === "dark" ? [6, 18, 43, 255] : [255, 255, 255, 255],
              getLineWidth: 1,
              lineWidthUnits: "pixels",
              parameters: { depthWriteEnabled: false },
              opacity,
              updateTriggers: { getPosition: time, getFillColor: time },
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
  }, [route, finished, theme, replay]);

  return <div ref={containerRef} className="trace-map" role="region" aria-label="Route map" />;
}
