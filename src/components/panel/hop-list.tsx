"use client";

import { flag, formatLoss, formatMs } from "@/lib/format";
import { latencyBand } from "@/lib/geo/route";
import type { AddressInfo, EnrichedHop } from "@/lib/traceroute/types";

interface HopListProps {
  hops: EnrichedHop[];
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

function HopRow({ hop, selected, isDestination, onSelect }: {
  hop: EnrichedHop;
  selected: boolean;
  isDestination: boolean;
  onSelect(): void;
}) {
  const [primary, ...others] = hop.addresses;
  const band = latencyBand(hop.rtt?.avg);

  if (!primary) {
    return (
      <li className="hop hop--silent">
        <span className="hop__number">{hop.hop}</span>
        <div className="hop__body">
          <span className="hop__silent">No reply</span>
          <span className="hop__meta">The router did not answer these probes; the path continues past it.</span>
        </div>
      </li>
    );
  }

  return (
    <li id={`hop-${hop.hop}`} className="hop" data-selected={selected || undefined}>
      <button type="button" className="hop__button" onClick={onSelect} aria-pressed={selected}>
        <span className="hop__number" data-band={band}>
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
          <span className="hop__rtt" data-band={band}>
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

export function HopList({ hops, selectedHop, destinationIp, onSelect }: HopListProps) {
  return (
    <ol className="hops" aria-label="Hops">
      {hops.map((hop) => (
        <HopRow
          key={hop.hop}
          hop={hop}
          selected={hop.hop === selectedHop}
          isDestination={Boolean(destinationIp && hop.ips.includes(destinationIp))}
          onSelect={() => onSelect(hop.hop)}
        />
      ))}
    </ol>
  );
}
