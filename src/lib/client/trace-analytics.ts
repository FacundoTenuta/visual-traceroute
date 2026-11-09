import type { ProbeLocation } from "@/lib/globalping/catalog";
import { isIPv4, looksLikeIPv6 } from "@/lib/net/ip";
import { validateTarget } from "@/lib/traceroute/target";
import type { EnrichedHop } from "@/lib/traceroute/types";
import type { AnalyticsParams } from "./analytics";
import type { TraceOrigin } from "./origins";
import { countHopCountries, type TraceState } from "./trace-state";

/** Where a trace starts, as event params: the probe city for remote origins, nothing more for local ones. */
export function originParams(origin: TraceOrigin, locations: ProbeLocation[]): AnalyticsParams {
  if (origin.kind === "local") return { origin_type: "local" };
  const location = locations.find((l) => l.id === origin.locationId);
  return {
    origin_type: "remote",
    origin_city: location?.city,
    origin_country: location?.country,
    asn: origin.asn,
  };
}

/** Drops absent values so the params compare and serialize cleanly. */
const compact = (params: AnalyticsParams): AnalyticsParams =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== null && value !== undefined));

/**
 * `trace_start` params. A hostname is sent as the server will trace it; an IP
 * address is reported only as `target_type: "ip"`, and input that is neither
 * (free text) only as `"invalid"`, so no address or typed text leaves the page.
 */
export function traceStartParams(target: string, origin: TraceOrigin, locations: ProbeLocation[]): AnalyticsParams {
  const result = validateTarget(target);
  let targetParams: AnalyticsParams;
  if (result.ok) {
    targetParams = isIPv4(result.value)
      ? { target_type: "ip" }
      : { target_type: "hostname", target_host: result.value };
  } else {
    const bare = target.trim().replace(/^\[|\]$/g, "");
    targetParams = { target_type: looksLikeIPv6(bare) ? "ip" : "invalid" };
  }
  return compact({ ...originParams(origin, locations), ...targetParams });
}

/** `trace_complete` params: the same totals the summary panel shows. */
export function traceCompleteParams(
  state: TraceState,
  hops: EnrichedHop[],
  distanceKm: number,
  start: { origin_type?: AnalyticsParams[string]; origin_city?: AnalyticsParams[string] },
): AnalyticsParams {
  return compact({
    origin_type: start.origin_type,
    // A local trace learns its city from the stream's `origin` event.
    origin_city: start.origin_city ?? state.origin?.city,
    hops: hops.length,
    reached: state.reached ?? false,
    distance_km: Math.round(distanceKm),
    countries: countHopCountries(hops),
    duration_ms: state.elapsedMs,
  });
}

export type TraceErrorReason = "validation" | "rate_limit" | "quota" | "unavailable" | "http";

/** Why `/api/trace` refused to start: a 429 with `retry-after` is the hourly quota, without it the concurrency limit. */
export function traceErrorReason(status: number, hasRetryAfter: boolean): TraceErrorReason {
  if (status === 400) return "validation";
  if (status === 429) return hasRetryAfter ? "quota" : "rate_limit";
  if (status === 503) return "unavailable";
  return "http";
}
