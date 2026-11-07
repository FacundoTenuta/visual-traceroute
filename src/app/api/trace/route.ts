import { ipApi } from "@/lib/geo/ip-api";
import { reverseDns } from "@/lib/geo/reverse-dns";
import { runTraceSession } from "@/lib/traceroute/session";
import { traceLimiter } from "@/lib/traceroute/limiter";
import { spawnTraceroute } from "@/lib/traceroute/spawn";
import { validateTarget } from "@/lib/traceroute/target";
import type { TraceEvent } from "@/lib/traceroute/types";

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

export async function GET(request: Request) {
  const result = validateTarget(new URL(request.url).searchParams.get("target") ?? "");
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  const slot = traceLimiter.acquire(clientKey(request));
  if (!slot.ok) return Response.json({ error: slot.error }, { status: 429 });

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
      try {
        await runTraceSession(
          result.value,
          {
            source: spawnTraceroute(result.value, controller.signal),
            geolocate: ipApi.geolocate,
            origin: ipApi.origin,
            reverseDns,
          },
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
