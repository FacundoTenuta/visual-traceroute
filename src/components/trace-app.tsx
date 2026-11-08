"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { selectHops } from "@/lib/client/trace-state";
import type { TraceOrigin } from "@/lib/client/origins";
import { buildRoute } from "@/lib/geo/route";
import { TraceMap, type MapFocus } from "./map/trace-map";
import { HopList } from "./panel/hop-list";
import { LatencyLegend } from "./panel/latency-legend";
import { SearchForm } from "./panel/search-form";
import { ThemeSwitch } from "./panel/theme-switch";
import { TraceSummary } from "./panel/trace-summary";
import { OriginPicker } from "./panel/origin-picker";
import { useProbes } from "./use-probes";
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
  const probes = useProbes();
  /** Where traces start; until the user picks, this computer if possible, else the nearest probe city. */
  const [chosenOrigin, setChosenOrigin] = useState<TraceOrigin | null>(null);
  const origin = useMemo<TraceOrigin | null>(
    () =>
      chosenOrigin ??
      (probes.local
        ? { kind: "local" }
        : probes.nearest
          ? { kind: "remote", locationId: probes.nearest }
          : null),
    [chosenOrigin, probes.local, probes.nearest],
  );
  /** Bumped by "Replay route"; the map redraws the route from the start. */
  const [replay, setReplay] = useState(0);
  const narrow = useIsNarrow();

  const hops = useMemo(() => selectHops(state), [state]);
  const route = useMemo(() => buildRoute(state.origin, hops), [state.origin, hops]);
  const running = state.status === "running";
  const finished = state.status === "done" || state.status === "cancelled";
  const canReplay = finished && route.segments.features.length > 0;

  const trace = useCallback(
    (target: string) => {
      setSelectedHop(null);
      // Before the location list arrives, local is the only sensible default.
      void start(target, origin ?? { kind: "local" });
    },
    [start, origin],
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
        finished={finished}
        replay={replay}
        selectedHop={selectedHop}
        focus={focus}
        padding={narrow ? MOBILE_PADDING : DESKTOP_PADDING}
        onSelectHop={selectHop}
        probeLocations={probes.locations}
        selectedOrigin={origin?.kind === "remote" ? origin.locationId : null}
        onPickOrigin={(locationId) => !running && setChosenOrigin({ kind: "remote", locationId })}
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
        <OriginPicker origin={origin} probes={probes} disabled={running} onChange={setChosenOrigin} />

        <div className="panel__scroll">
          {state.status === "idle" ? (
            <section className="intro">
              <p>
                See the path your packets take to any server. Every router that answers appears on the globe with its
                location, network and round-trip time.
              </p>
              <p className="intro__note">
                {probes.local ? "Pick where the trace starts: this computer, or any of " : "Pick where the trace starts: any of "}
                {probes.locations.length ? probes.locations.length.toLocaleString("en-US") : "1,000+"} cities with probes. You
                can also click a dot on the globe.
              </p>
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
              <TraceSummary
                state={state}
                hops={hops}
                distanceKm={route.distanceKm}
                onReplay={canReplay ? () => setReplay((n) => n + 1) : undefined}
              />
              <HopList
                hops={hops}
                theme={theme.resolved}
                // Only a trace that ran to its end can blame the destination for silence.
                finished={state.status === "done"}
                selectedHop={selectedHop}
                destinationIp={state.resolvedIp}
                onSelect={selectHop}
              />
            </>
          )}
        </div>
      </aside>

      <LatencyLegend theme={theme.resolved} />
    </main>
  );
}
