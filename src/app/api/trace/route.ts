import { ipApi } from "@/lib/geo/ip-api";
import { reverseDns } from "@/lib/geo/reverse-dns";
import { runTraceSession } from "@/lib/traceroute/session";
import { spawnTraceroute } from "@/lib/traceroute/spawn";
import { validateTarget } from "@/lib/traceroute/target";
import type { TraceEvent } from "@/lib/traceroute/types";

const MAX_CONCURRENT_TRACES = 3;
let activeTraces = 0;

const encoder = new TextEncoder();
const frame = (event: TraceEvent) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

export async function GET(request: Request) {
  const result = validateTarget(new URL(request.url).searchParams.get("target") ?? "");
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  if (activeTraces >= MAX_CONCURRENT_TRACES) {
    return Response.json({ error: "Too many traces running. Try again in a moment." }, { status: 429 });
  }
  activeTraces++;

  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(sink) {
      const emit = (event: TraceEvent) => {
        if (!controller.signal.aborted) sink.enqueue(frame(event));
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
        activeTraces--;
        if (!controller.signal.aborted) sink.close();
      }
    },
    cancel() {
      controller.abort();
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
