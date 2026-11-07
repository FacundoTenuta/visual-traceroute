import type { EnrichedHop, GeoInfo, TraceEvent } from "@/lib/traceroute/types";

export type TraceStatus = "idle" | "running" | "done" | "error" | "cancelled";

export interface TraceState {
  status: TraceStatus;
  target: string | null;
  resolvedIp: string | null;
  maxHops: number | null;
  origin: GeoInfo | null;
  destination: { geo: GeoInfo | null; hostname: string | null } | null;
  hops: Record<number, EnrichedHop>;
  elapsedMs: number | null;
  reached: boolean | null;
  error: string | null;
}

export type TraceAction =
  | { type: "begin"; target: string }
  | { type: "event"; event: TraceEvent }
  | { type: "fail"; message: string }
  | { type: "cancel" };

export const initialTraceState: TraceState = {
  status: "idle",
  target: null,
  resolvedIp: null,
  maxHops: null,
  origin: null,
  destination: null,
  hops: {},
  elapsedMs: null,
  reached: null,
  error: null,
};

function applyEvent(state: TraceState, event: TraceEvent): TraceState {
  switch (event.type) {
    case "start":
      return { ...state, resolvedIp: event.ip, maxHops: event.maxHops };
    case "origin":
      return { ...state, origin: event.geo };
    case "destination":
      return { ...state, destination: { geo: event.geo, hostname: event.hostname } };
    case "hop":
      return { ...state, hops: { ...state.hops, [event.hop.hop]: event.hop } };
    case "done":
      return { ...state, status: "done", elapsedMs: event.elapsedMs, reached: event.reached };
    case "error":
      return { ...state, status: "error", error: event.message };
  }
}

export function traceReducer(state: TraceState, action: TraceAction): TraceState {
  switch (action.type) {
    case "begin":
      return { ...initialTraceState, status: "running", target: action.target };
    case "event":
      return applyEvent(state, action.event);
    case "fail":
      return { ...state, status: "error", error: action.message };
    case "cancel":
      return { ...state, status: "cancelled" };
  }
}

export function selectHops(state: TraceState): EnrichedHop[] {
  return Object.values(state.hops).sort((a, b) => a.hop - b.hop);
}
