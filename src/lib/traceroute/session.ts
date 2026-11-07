import { isPrivateIPv4 } from "@/lib/net/ip";
import { HopAccumulator, parseHeader, type Hop } from "./parser";
import type { AddressInfo, EnrichedHop, GeoInfo, TraceEvent } from "./types";

export interface LineSource {
  lines: AsyncIterable<{ stream: "stdout" | "stderr"; line: string }>;
  exit: Promise<number | null>;
}

export interface SessionDeps {
  source: LineSource;
  geolocate(ip: string): Promise<GeoInfo | null>;
  reverseDns(ip: string): Promise<string | null>;
  /** Public location of the machine running traceroute. */
  origin(): Promise<GeoInfo | null>;
  now?: () => number;
}

type Lookup = { hostname: string | null; geo: GeoInfo | null };

const settle = <T>(promise: Promise<T>): Promise<T | null> => promise.catch(() => null);

function readableError(stderr: string[]): string {
  const line = stderr.find((l) => l.trim()) ?? "traceroute failed";
  const message = line.replace(/^traceroute:\s*/i, "").trim();
  return message.charAt(0).toUpperCase() + message.slice(1);
}

/**
 * Consumes raw traceroute output and emits structured events. Every hop is
 * emitted as soon as it is parsed and re-emitted whenever one of its addresses
 * finishes enrichment (reverse DNS + geolocation), so clients can upsert by
 * hop number.
 */
export async function runTraceSession(
  target: string,
  deps: SessionDeps,
  emit: (event: TraceEvent) => void,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const accumulator = new HopAccumulator();
  const latest = new Map<number, Hop>();
  const lookups = new Map<string, Promise<Lookup>>();
  const resolved = new Map<string, Lookup>();
  const pending: Promise<unknown>[] = [];
  const stderr: string[] = [];
  let destinationIp: string | null = null;

  const toAddress = (ip: string): AddressInfo => {
    const done = resolved.get(ip);
    return {
      ip,
      isPrivate: isPrivateIPv4(ip),
      hostname: done?.hostname ?? null,
      geo: done?.geo ?? null,
      pending: !done,
    };
  };

  const emitHop = (hop: Hop) => {
    const enriched: EnrichedHop = { ...hop, addresses: hop.ips.map(toAddress) };
    emit({ type: "hop", hop: enriched });
  };

  const lookup = (ip: string): Promise<Lookup> => {
    let promise = lookups.get(ip);
    if (!promise) {
      // Private hops belong to the server's own network: never resolve or locate
      // them, so internal hostnames are not exposed to API callers.
      const isPrivate = isPrivateIPv4(ip);
      const geo = isPrivate ? Promise.resolve(null) : settle(deps.geolocate(ip));
      const hostname = isPrivate ? Promise.resolve(null) : settle(deps.reverseDns(ip));
      promise = Promise.all([hostname, geo]).then(([hostname, geoInfo]) => {
        const result = { hostname, geo: geoInfo };
        resolved.set(ip, result);
        for (const hop of latest.values()) if (hop.ips.includes(ip)) emitHop(hop);
        return result;
      });
      lookups.set(ip, promise);
      pending.push(promise);
    }
    return promise;
  };

  for await (const { stream, line } of deps.source.lines) {
    if (stream === "stderr") {
      const header = parseHeader(line);
      if (header && destinationIp === null) {
        destinationIp = header.ip;
        emit({ type: "start", target, ip: header.ip, maxHops: header.maxHops });
        pending.push(settle(deps.origin()).then((geo) => emit({ type: "origin", geo })));
        pending.push(
          lookup(header.ip).then(({ geo, hostname }) => emit({ type: "destination", geo, hostname })),
        );
      } else if (!header) {
        stderr.push(line);
      }
      continue;
    }

    const hop = accumulator.push(line);
    if (!hop) continue;
    latest.set(hop.hop, hop);
    emitHop(hop);
    hop.ips.forEach(lookup);
  }

  const exitCode = await deps.source.exit;
  await Promise.all(pending);

  const hops = accumulator.hops();
  if (hops.length === 0 && exitCode !== 0) {
    emit({ type: "error", message: readableError(stderr) });
    return;
  }

  const last = hops.at(-1);
  emit({
    type: "done",
    elapsedMs: now() - startedAt,
    hops: hops.length,
    reached: Boolean(last && destinationIp && last.ips.includes(destinationIp)),
  });
}
