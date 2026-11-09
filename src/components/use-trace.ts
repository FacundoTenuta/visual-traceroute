"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { track } from "@/lib/client/analytics";
import { traceUrl, type TraceOrigin } from "@/lib/client/origins";
import { SseDecoder } from "@/lib/client/sse";
import { traceErrorReason } from "@/lib/client/trace-analytics";
import { initialTraceState, traceReducer } from "@/lib/client/trace-state";
import type { TraceEvent } from "@/lib/traceroute/types";

export function useTrace() {
  const [state, dispatch] = useReducer(traceReducer, initialTraceState);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;
    dispatch({ type: "cancel" });
  }, []);

  const start = useCallback(async (target: string, origin: TraceOrigin) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "begin", target });

    try {
      const res = await fetch(traceUrl(target, origin), { signal: controller.signal });
      if (!res.ok || !res.body) {
        track("trace_error", { status: res.status, reason: traceErrorReason(res.status, res.headers.has("retry-after")) });
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        dispatch({ type: "fail", message: body?.error ?? `The trace could not start (HTTP ${res.status}).` });
        return;
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      const decoder = new SseDecoder();
      let finished = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const event of decoder.push(value) as TraceEvent[]) {
          dispatch({ type: "event", event });
          if (event.type === "done" || event.type === "error") finished = true;
          if (event.type === "error") track("trace_error", { status: res.status, reason: "stream" });
        }
      }
      if (!finished && !controller.signal.aborted) {
        track("trace_error", { status: res.status, reason: "network" });
        dispatch({ type: "fail", message: "The connection closed before the trace finished." });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        track("trace_error", { status: 0, reason: "network" });
        dispatch({ type: "fail", message: error instanceof Error ? error.message : "The trace failed." });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, start, stop };
}
