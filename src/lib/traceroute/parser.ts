import { isIPv4, looksLikeIPv6 } from "@/lib/net/ip";

export interface Probe {
  ip: string | null;
  rtt: number | null;
}

export interface RttStats {
  min: number;
  avg: number;
  max: number;
}

export interface Hop {
  hop: number;
  probes: Probe[];
  /** Unique responding addresses, in the order they answered. */
  ips: string[];
  primaryIp: string | null;
  rtt: RttStats | null;
  /** Fraction of probes without a reply, 0..1. */
  loss: number;
  /** ICMP annotations such as !H, !N or !X. */
  annotations: string[];
}

export interface TraceHeader {
  target: string;
  ip: string;
  maxHops: number;
}

const HEADER_RE = /^traceroute to (\S+) \(([^)]+)\), (\d+) hops max/;

export function parseHeader(line: string): TraceHeader | null {
  const match = HEADER_RE.exec(line.trim());
  if (!match) return null;
  return { target: match[1], ip: match[2], maxHops: Number(match[3]) };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function summarize(hop: number, probes: Probe[], annotations: string[]): Hop {
  const ips = [...new Set(probes.flatMap((p) => (p.ip ? [p.ip] : [])))];
  const rtts = probes.flatMap((p) => (p.rtt === null ? [] : [p.rtt]));
  const rtt =
    rtts.length === 0
      ? null
      : {
          min: Math.min(...rtts),
          avg: round(rtts.reduce((a, b) => a + b, 0) / rtts.length),
          max: Math.max(...rtts),
        };
  return {
    hop,
    probes,
    ips,
    primaryIp: ips[0] ?? null,
    rtt,
    loss: probes.length === 0 ? 1 : probes.filter((p) => p.rtt === null).length / probes.length,
    annotations: [...new Set(annotations)],
  };
}

function parseProbes(tokens: string[], probes: Probe[], annotations: string[]) {
  let currentIp: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "*") {
      probes.push({ ip: null, rtt: null });
    } else if (isIPv4(token) || looksLikeIPv6(token)) {
      currentIp = token;
    } else if (/^\d+(\.\d+)?$/.test(token) && tokens[i + 1] === "ms") {
      probes.push({ ip: currentIp, rtt: Number(token) });
      i++;
    } else if (token.startsWith("!")) {
      annotations.push(token);
    }
  }
}

/**
 * Stateful, line-by-line traceroute parser. Every `push` returns the updated
 * hop (so callers can stream partial results) or null when the line carried no
 * hop data. Indented lines without a hop number are load-balanced paths of the
 * previous hop and are merged into it.
 */
export class HopAccumulator {
  private readonly raw = new Map<number, { probes: Probe[]; annotations: string[] }>();
  private current: number | null = null;

  push(line: string): Hop | null {
    if (!line.trim() || parseHeader(line)) return null;
    const tokens = line.trim().split(/\s+/);

    let hopNumber: number;
    if (/^\d+$/.test(tokens[0])) {
      hopNumber = Number(tokens.shift());
      this.current = hopNumber;
      this.raw.set(hopNumber, { probes: [], annotations: [] });
    } else if (this.current !== null && /^\s/.test(line)) {
      hopNumber = this.current;
    } else {
      return null;
    }

    const entry = this.raw.get(hopNumber)!;
    parseProbes(tokens, entry.probes, entry.annotations);
    return summarize(hopNumber, [...entry.probes], entry.annotations);
  }

  hops(): Hop[] {
    return [...this.raw.entries()]
      .sort(([a], [b]) => a - b)
      .map(([hop, { probes, annotations }]) => summarize(hop, [...probes], annotations));
  }
}
