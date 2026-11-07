const BANDS = [
  { band: "fast", label: "under 50 ms" },
  { band: "medium", label: "50–150 ms" },
  { band: "slow", label: "150–300 ms" },
  { band: "critical", label: "over 300 ms" },
];

export function LatencyLegend() {
  return (
    <div className="legend" aria-label="Average round-trip time">
      <span className="legend__title">Round trip</span>
      <ul>
        {BANDS.map(({ band, label }) => (
          <li key={band}>
            <span className="legend__swatch" data-band={band} aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
