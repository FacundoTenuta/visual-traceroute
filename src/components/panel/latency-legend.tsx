import { LATENCY_MAX_MS, LATENCY_STOPS, latencyGradientCss, type ScaleTheme } from "@/lib/latency-scale";

export function LatencyLegend({ theme }: { theme: ScaleTheme }) {
  return (
    <div className="legend" aria-label={`Average round-trip time, from 0 to ${LATENCY_MAX_MS} ms and more`}>
      <span className="legend__title">Round trip</span>
      <span className="legend__bar" style={{ background: latencyGradientCss(theme) }} aria-hidden="true" />
      <span className="legend__ticks" aria-hidden="true">
        {LATENCY_STOPS[theme].map(([ms], i, all) => (
          <span key={ms} style={{ left: `${(ms / LATENCY_MAX_MS) * 100}%` }}>
            {i === all.length - 1 ? `${ms}+` : ms} {i === 0 ? "ms" : ""}
          </span>
        ))}
      </span>
    </div>
  );
}
