"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { selectHops } from "@/lib/client/trace-state";
import { buildRoute } from "@/lib/geo/route";
import { TraceMap, type MapFocus } from "./map/trace-map";
import { HopList } from "./panel/hop-list";
import { LatencyLegend } from "./panel/latency-legend";
import { SearchForm } from "./panel/search-form";
import { ThemeSwitch } from "./panel/theme-switch";
import { TraceSummary } from "./panel/trace-summary";
import { useTheme } from "./use-theme";
import { useTrace } from "./use-trace";

const SUGGESTIONS = ["cloudflare.com", "github.com", "bbc.co.uk", "www.u-tokyo.ac.jp", "gov.br"];
const DESKTOP_PADDING = { top: 0, right: 404, bottom: 0, left: 0 };
const MOBILE_PADDING = { top: 70, right: 0, bottom: 400, left: 0 };

const NARROW_QUERY = "(max-width: 760px)";

function subscribeNarrow(callback: () => void) {
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function useIsNarrow() {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

export function TraceApp() {
  const { state, start, stop } = useTrace();
  const theme = useTheme();
  const [selectedHop, setSelectedHop] = useState<number | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const narrow = useIsNarrow();

  const hops = useMemo(() => selectHops(state), [state]);
  const route = useMemo(() => buildRoute(state.origin, hops), [state.origin, hops]);
  const running = state.status === "running";

  const trace = useCallback(
    (target: string) => {
      setSelectedHop(null);
      void start(target);
    },
    [start],
  );

  const selectHop = useCallback(
    (hop: number) => {
      setSelectedHop(hop);
      const stop = route.stops.find((s) => s.hops.includes(hop));
      if (stop) setFocus({ coord: stop.coord, nonce: Date.now() });
      document.getElementById(`hop-${hop}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [route],
  );

  return (
    <main className="app">
      <TraceMap
        theme={theme.resolved}
        route={route}
        selectedHop={selectedHop}
        focus={focus}
        padding={narrow ? MOBILE_PADDING : DESKTOP_PADDING}
        onSelectHop={selectHop}
      />

      <aside className="panel" aria-label="Trace details">
        <header className="panel__header">
          <div className="brand">
            <svg className="brand__mark" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9.5" />
              <path d="M2.5 12h19M12 2.5c3 3.2 3 15.8 0 19M12 2.5c-3 3.2-3 15.8 0 19" />
            </svg>
            <h1>Visual traceroute</h1>
          </div>
          <ThemeSwitch value={theme.preference} onChange={theme.setPreference} />
        </header>

        <SearchForm running={running} onTrace={trace} onStop={stop} />

        <div className="panel__scroll">
          {state.status === "idle" ? (
            <section className="intro">
              <p>
                See the path your packets take to any server. Every router that answers appears on the globe with its
                location, network and round-trip time.
              </p>
              <p className="intro__note">Traces start from the computer running this app.</p>
              <div className="intro__suggestions" aria-label="Try a host">
                {SUGGESTIONS.map((host) => (
                  <button key={host} type="button" className="chip" onClick={() => trace(host)}>
                    {host}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <>
              <TraceSummary state={state} hops={hops} distanceKm={route.distanceKm} />
              <HopList
                hops={hops}
                selectedHop={selectedHop}
                destinationIp={state.resolvedIp}
                onSelect={selectHop}
              />
            </>
          )}
        </div>
      </aside>

      <LatencyLegend />
    </main>
  );
}
