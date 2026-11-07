"use client";

import { flag, formatLoss, formatMs } from "@/lib/format";
import { groupHops } from "@/lib/client/hop-groups";
import { latencyColor, type ScaleTheme } from "@/lib/latency-scale";
import type { AddressInfo, EnrichedHop } from "@/lib/traceroute/types";

interface HopListProps {
  hops: EnrichedHop[];
  theme: ScaleTheme;
  /** The trace ran to its end (not stopped), so a final silent run can be summarised. */
  finished: boolean;
  selectedHop: number | null;
  destinationIp: string | null;
  onSelect(hop: number): void;
}

function place(address: AddressInfo): string | null {
  if (address.isPrivate) return "Private network";
  const geo = address.geo;
  if (!geo) return address.pending ? "Locating…" : "Location unknown";
  return [geo.city, geo.countryCode].filter(Boolean).join(", ") || geo.country;
}

function network(address: AddressInfo): string | null {
  const geo = address.geo;
  if (!geo) return null;
  const name = geo.asName ?? geo.isp ?? geo.org;
  return [geo.asn, name].filter(Boolean).join(" ") || null;
}

function HopRow({ hop, theme, selected, isDestination, onSelect }: {
  hop: EnrichedHop;
  theme: ScaleTheme;
  selected: boolean;
  isDestination: boolean;
  onSelect(): void;
}) {
  const [primary, ...others] = hop.addresses;
  // Same continuous light-blue → red scale as the map.
  const color = { "--band": latencyColor(hop.rtt?.avg, theme) } as React.CSSProperties;

  return (
    <li id={`hop-${hop.hop}`} className="hop" data-selected={selected || undefined}>
      <button type="button" className="hop__button" onClick={onSelect} aria-pressed={selected}>
        <span className="hop__number" style={color}>
          {hop.hop}
        </span>
        <span className="hop__body">
          <span className="hop__ip">
            {primary.ip}
            {isDestination && <span className="tag tag--destination">Destination</span>}
            {primary.isPrivate && <span className="tag">Private</span>}
          </span>
          {primary.hostname && <span className="hop__host" title={primary.hostname}>{primary.hostname}</span>}
          <span className="hop__meta">
            {primary.geo?.countryCode && <span aria-hidden="true">{flag(primary.geo.countryCode)} </span>}
            {place(primary)}
          </span>
          {network(primary) && <span className="hop__meta">{network(primary)}</span>}
          {others.length > 0 && (
            <span className="hop__meta hop__alt">
              Also answered: {others.map((a) => a.ip).join(", ")}
            </span>
          )}
        </span>
        <span className="hop__timing">
          <span className="hop__rtt" style={color}>
            {formatMs(hop.rtt?.avg)}
          </span>
          {hop.rtt && (
            <span className="hop__range">
              {formatMs(hop.rtt.min)} – {formatMs(hop.rtt.max)}
            </span>
          )}
          {hop.loss > 0 && <span className="hop__loss">{formatLoss(hop.loss)} lost</span>}
          {hop.annotations.length > 0 && <span className="hop__loss">{hop.annotations.join(" ")}</span>}
        </span>
      </button>
    </li>
  );
}

const SILENT_HINT = "These routers did not answer the probes. That is common (they filter or rate-limit them) and the path continues past them.";

function SilentRow({ from, to, trailing }: { from: number; to: number; trailing: boolean }) {
  const range = from === to ? `Hop ${from}` : `Hops ${from}–${to}`;
  return (
    <li className="hop hop--silent" data-trailing={trailing || undefined} title={trailing ? undefined : SILENT_HINT}>
      <span className="hop__number" aria-hidden="true" />
      <div className="hop__body">
        {trailing ? (
          <>
            <span className="hop__silent">{range} didn&apos;t answer</span>
            <span className="hop__meta">The destination, or the routers just before it, filter traceroute probes.</span>
          </>
        ) : (
          <span className="hop__silent">{range} · no reply</span>
        )}
      </div>
    </li>
  );
}

export function HopList({ hops, theme, finished, selectedHop, destinationIp, onSelect }: HopListProps) {
  return (
    <ol className="hops" aria-label="Hops">
      {groupHops(hops, finished).map((item) =>
        item.kind === "silent" ? (
          <SilentRow key={`silent-${item.from}`} from={item.from} to={item.to} trailing={item.trailing} />
        ) : (
          <HopRow
            key={item.hop.hop}
            hop={item.hop}
            theme={theme}
            selected={item.hop.hop === selectedHop}
            isDestination={Boolean(destinationIp && item.hop.ips.includes(destinationIp))}
            onSelect={() => onSelect(item.hop.hop)}
          />
        ),
      )}
    </ol>
  );
}
