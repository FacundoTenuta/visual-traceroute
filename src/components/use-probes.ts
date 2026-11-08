"use client";

import { useEffect, useState } from "react";
import type { ProbeLocation } from "@/lib/globalping/catalog";

export interface ProbesState {
  status: "loading" | "ready" | "error";
  locations: ProbeLocation[];
  /** Location nearest the visitor: the default remote origin. */
  nearest: string | null;
  /** This server can run traceroute itself. */
  local: boolean;
  /** Remote locations could be loaded. */
  remote: boolean;
}

const INITIAL: ProbesState = { status: "loading", locations: [], nearest: null, local: false, remote: false };

/** Loads the trace origins once, after the first paint, so it never delays the page. */
export function useProbes(): ProbesState {
  const [state, setState] = useState<ProbesState>(INITIAL);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch("/api/probes", { signal: controller.signal })
        .then((res) => res.json() as Promise<Omit<ProbesState, "status">>)
        .then((body) => setState({ ...body, status: "ready" }))
        .catch(() => {
          if (!controller.signal.aborted) setState({ ...INITIAL, status: "error" });
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);
  return state;
}
