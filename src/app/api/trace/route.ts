import { probeCatalog } from "@/lib/globalping/catalog";
import { globalping, probeToGeo, toTracerouteLines, type GpLocation } from "@/lib/globalping/measure";
import { ipApi } from "@/lib/geo/ip-api";
import { reverseDns } from "@/lib/geo/reverse-dns";
import { runTraceSession } from "@/lib/traceroute/session";
import { isLocalTraceAvailable } from "@/lib/traceroute/available";
import { traceLimiter } from "@/lib/traceroute/limiter";
import { HourlyQuota, remoteTracesPerHour } from "@/lib/traceroute/quota";
import { remoteLineSource } from "@/lib/traceroute/remote";
import type { LineSource } from "@/lib/traceroute/session";
import { spawnTraceroute } from "@/lib/traceroute/spawn";
import { validateTarget } from "@/lib/traceroute/target";
import type { GeoInfo, TraceEvent } from "@/lib/traceroute/types";

/** Hard stop for a single trace (30 hops x 3 probes x 2 s is about 3 minutes worst case). */
const TRACE_TIMEOUT_MS = 150_000;

/**
 * Caller id for the per-client cap. Forwarding headers can be forged by any
 * direct caller, so they are read only when TRUST_PROXY=1 says a proxy in
 * front overwrites them. Otherwise callers are anonymous and only the global
 * cap applies (direct local use is a single user anyway).
 */
function clientKey(request: Request): string | null {
  if (process.env.TRUST_PROXY !== "1") return null;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || null;
}

const encoder = new TextEncoder();
const frame = (event: TraceEvent) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

/** Each visitor's share of the Globalping quota (all visitors share one account). */
const REMOTE_PER_HOUR = remoteTracesPerHour(process.env.REMOTE_TRACES_PER_HOUR);
const remoteQuota = new HourlyQuota({ limit: REMOTE_PER_HOUR });

const waitText = (seconds: number) => {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
};

const badRequest = (error: string) => Response.json({ error }, { status: 400 });

/**
 * Where to trace from: a probe location from the Globalping catalog (`from`,
 * optionally narrowed to one network with `asn`), or this server. Only ids
 * from the catalog are accepted, so no free-form input reaches the remote API.
 */
async function resolveOrigin(
  params: URLSearchParams,
): Promise<{ remote: GpLocation | null } | { error: string; status?: number }> {
  const from = params.get("from");
  if (!from && params.has("asn")) return { error: "Pick a location before choosing a network." };
  if (!from) {
    return (await isLocalTraceAvailable())
      ? { remote: null }
      : { error: "This server can't run traceroute. Pick a location to trace from." };
  }
  let location;
  try {
    location = await probeCatalog.find(from);
  } catch {
    return { error: "Remote locations are unavailable right now. Try again in a minute.", status: 503 };
  }
  if (!location) return { error: "Unknown trace origin. Pick a location from the list." };
  const asnParam = params.get("asn");
  if (asnParam === null) return { remote: { country: location.country, city: location.city } };
  const asn = Number(asnParam);
  if (!location.networks.some((n) => n.asn === asn)) return { error: `That network has no probes in ${location.city}.` };
  return { remote: { country: location.country, city: location.city, asn } };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const result = validateTarget(params.get("target") ?? "");
  if (!result.ok) return badRequest(result.error);
  const origin = await resolveOrigin(params);
  if ("error" in origin) return Response.json({ error: origin.error }, { status: origin.status ?? 400 });

  const visitor = clientKey(request);
  const slot = traceLimiter.acquire(visitor);
  if (!slot.ok) return Response.json({ error: slot.error }, { status: 429 });
  // Checked after the concurrency slot so a rejected request never spends quota.
  if (origin.remote) {
    const quota = remoteQuota.take(visitor ?? "local");
    if (!quota.ok) {
      slot.release();
      return Response.json(
        {
          error: `You've used your ${REMOTE_PER_HOUR} remote traces for this hour. Try again in ${waitText(quota.retryAfterS)}.`,
        },
        { status: 429, headers: { "retry-after": String(quota.retryAfterS) } },
      );
    }
  }

  // Aborting this controller kills traceroute; the session then finishes with
  // the hops found so far. `clientGone` stops writes once the caller left.
  const controller = new AbortController();
  let clientGone = false;
  const leave = () => {
    clientGone = true;
    controller.abort();
  };
  if (request.signal.aborted) leave();
  request.signal.addEventListener("abort", leave, { once: true });
  const timeout = setTimeout(() => controller.abort(), TRACE_TIMEOUT_MS);

  const stream = new ReadableStream<Uint8Array>({
    async start(sink) {
      const emit = (event: TraceEvent) => {
        if (!clientGone) sink.enqueue(frame(event));
      };
      let source: LineSource;
      let traceOrigin: () => Promise<GeoInfo | null> = ipApi.origin;
      if (origin.remote) {
        const location = origin.remote;
        let probeGeo: GeoInfo | null = null;
        source = remoteLineSource(async () => {
          const out = await globalping.traceroute({ target: result.value, location, signal: controller.signal });
          probeGeo = probeToGeo(out.probe);
          return toTracerouteLines(result.value, out.result);
        }, controller.signal);
        traceOrigin = async () => probeGeo;
      } else {
        source = spawnTraceroute(result.value, controller.signal);
      }
      try {
        await runTraceSession(
          result.value,
          { source, geolocate: ipApi.geolocate, origin: traceOrigin, reverseDns },
          emit,
        );
      } catch {
        emit({ type: "error", message: "The trace stopped unexpectedly." });
      } finally {
        clearTimeout(timeout);
        slot.release();
        if (!clientGone) sink.close();
      }
    },
    cancel() {
      leave();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
