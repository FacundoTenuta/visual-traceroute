"use client";

import { countHopCountries, type TraceState } from "@/lib/client/trace-state";
import { flag, formatDuration, formatKm, formatMs } from "@/lib/format";
import type { EnrichedHop, GeoInfo } from "@/lib/traceroute/types";

interface TraceSummaryProps {
  state: TraceState;
  hops: EnrichedHop[];
  distanceKm: number;
  /** Replays the route animation; shown once a trace has a drawn route and has ended. */
  onReplay?: () => void;
}

const where = (geo: GeoInfo | null | undefined) =>
  geo ? [geo.city, geo.country].filter(Boolean).join(", ") : "Unknown location";

function statusText(state: TraceState, hops: EnrichedHop[]): string {
  const last = hops.at(-1)?.hop ?? 0;
  switch (state.status) {
    case "running":
      return last ? `Tracing… hop ${last} of up to ${state.maxHops ?? 30}` : "Starting trace…";
    case "done":
      return state.reached
        ? `Reached in ${hops.length} hops, ${formatDuration(state.elapsedMs ?? 0)}`
        : `Destination did not answer after ${hops.length} hops`;
    case "cancelled":
      return `Stopped after ${hops.length} hops`;
    case "error":
      return state.error ?? "The trace failed.";
    default:
      return "";
  }
}

export function TraceSummary({ state, hops, distanceKm, onReplay }: TraceSummaryProps) {
  const lastAnswered = [...hops].reverse().find((h) => h.rtt);
  const countries = countHopCountries(hops);
  const destinationGeo = state.destination?.geo;

  return (
    <section className="summary" aria-label="Trace summary">
      <div className="summary__route">
        <div className="summary__end">
          <span className="summary__label">From</span>
          <span className="summary__value">
            {state.origin ? `${flag(state.origin.countryCode)} ${where(state.origin)}` : "This machine"}
          </span>
          {state.origin && <span className="summary__sub mono">{state.origin.ip || state.origin.isp}</span>}
        </div>
        <div className="summary__end">
          <span className="summary__label">To</span>
          <span className="summary__value">
            {destinationGeo ? `${flag(destinationGeo.countryCode)} ${where(destinationGeo)}` : state.target}
          </span>
          <span className="summary__sub mono">
            {state.destination?.hostname ?? state.target}
            {state.resolvedIp && state.resolvedIp !== state.target ? ` (${state.resolvedIp})` : ""}
          </span>
        </div>
      </div>

      <div className="summary__status-row">
        <p className="summary__status" data-status={state.status} role="status" aria-live="polite">
          {state.status === "running" && <span className="spinner" aria-hidden="true" />}
          {statusText(state, hops)}
        </p>
        {onReplay && (
          <button type="button" className="replay" onClick={onReplay}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
              <path d="M2.5 2.5v3h3" />
            </svg>
            Replay route
          </button>
        )}
      </div>

      {hops.length > 0 && (
        <dl className="stats">
          <div>
            <dt>Hops</dt>
            <dd>{hops.length}</dd>
          </div>
          <div>
            <dt>Last RTT</dt>
            <dd>{formatMs(lastAnswered?.rtt?.avg)}</dd>
          </div>
          <div>
            <dt>Distance</dt>
            <dd>{distanceKm ? formatKm(distanceKm) : "—"}</dd>
          </div>
          <div>
            <dt>Countries</dt>
            <dd>{countries || "—"}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
