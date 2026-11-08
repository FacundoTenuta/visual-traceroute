"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { flag } from "@/lib/format";
import { filterLocations, originLabel, type TraceOrigin } from "@/lib/client/origins";
import type { ProbesState } from "../use-probes";

interface OriginPickerProps {
  origin: TraceOrigin | null;
  probes: ProbesState;
  disabled: boolean;
  onChange(origin: TraceOrigin): void;
}

/** "From …" control: this computer, the probe city nearest the visitor, or any city (and network). */
export function OriginPicker({ origin, probes, disabled, onChange }: OriginPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const results = useMemo(() => filterLocations(probes.locations, query), [probes.locations, query]);
  const chosen = origin?.kind === "remote" ? probes.locations.find((l) => l.id === origin.locationId) : undefined;
  const nearest = probes.locations.find((l) => l.id === probes.nearest);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const pick = (next: TraceOrigin) => {
    onChange(next);
    if (next.kind === "local" || next.asn !== undefined) setOpen(false);
  };

  const label =
    probes.status === "loading" && !origin
      ? "Loading locations…"
      : origin
        ? originLabel(origin, probes.locations)
        : "Choose a location";

  return (
    <div className="origin" ref={rootRef}>
      <button
        type="button"
        className="origin__toggle"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="origin__from">From</span>
        <span className="origin__value">
          {chosen && <span aria-hidden="true">{flag(chosen.country)} </span>}
          {label}
        </span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="origin__panel" id={listId}>
          <input
            className="origin__search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a city, country code or network"
            aria-label="Search trace locations"
          />
          <ul className="origin__list">
            {probes.local && !query && (
              <li>
                <button type="button" className="origin__option" onClick={() => pick({ kind: "local" })}>
                  <strong>This computer</strong>
                  <span>Trace from the machine running this app</span>
                </button>
              </li>
            )}
            {nearest && !query && (
              <li>
                <button type="button" className="origin__option" onClick={() => pick({ kind: "remote", locationId: nearest.id })}>
                  <strong>
                    {flag(nearest.country)} Near you · {nearest.city}
                  </strong>
                  <span>Closest probe location to your connection</span>
                </button>
              </li>
            )}
            {results.map((location) => (
              <li key={location.id}>
                <button
                  type="button"
                  className="origin__option"
                  aria-current={chosen?.id === location.id || undefined}
                  onClick={() => pick({ kind: "remote", locationId: location.id })}
                >
                  <strong>
                    {flag(location.country)} {location.city}, {location.country}
                  </strong>
                  <span>
                    {location.probes} probe{location.probes === 1 ? "" : "s"} · {location.networks[0]?.network}
                  </span>
                </button>
                {chosen?.id === location.id && location.networks.length > 1 && (
                  <div className="origin__networks" aria-label={`Networks in ${location.city}`}>
                    <button
                      type="button"
                      className="chip"
                      aria-pressed={origin?.kind === "remote" && origin.asn === undefined}
                      onClick={() => pick({ kind: "remote", locationId: location.id, asn: undefined })}
                    >
                      Any network
                    </button>
                    {location.networks.map((n) => (
                      <button
                        key={n.asn}
                        type="button"
                        className="chip"
                        aria-pressed={origin?.kind === "remote" && origin.asn === n.asn}
                        onClick={() => pick({ kind: "remote", locationId: location.id, asn: n.asn })}
                      >
                        {n.network}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
            {probes.status === "error" && <li className="origin__empty">Remote locations are unavailable right now.</li>}
            {probes.status === "ready" && results.length === 0 && <li className="origin__empty">No probe location matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
