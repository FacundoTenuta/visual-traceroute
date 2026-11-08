import { displayCountry } from "@/lib/place-names";
import type { GeoInfo } from "@/lib/traceroute/types";

const API = "https://api.globalping.io/v1/measurements";
const REQUEST_TIMEOUT_MS = 8000;

export interface GpProbe {
  continent?: string;
  country: string;
  city: string;
  state?: string | null;
  asn: number;
  network: string;
  latitude: number;
  longitude: number;
}

export interface GpHop {
  resolvedAddress: string | null;
  resolvedHostname: string | null;
  timings: Array<{ rtt: number | null }>;
}

export interface GpResult {
  status: "in-progress" | "finished" | "failed" | "offline";
  rawOutput: string;
  resolvedAddress: string | null;
  resolvedHostname: string | null;
  hops: GpHop[];
}

/** Error whose message is safe and meant for the user. */
export class GlobalpingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** True when Globalping refused to create the measurement, so nothing ran or was charged. */
    public notStarted = false,
  ) {
    super(message);
    this.name = "GlobalpingError";
  }
}

export interface GpLocation {
  country: string;
  city: string;
  asn?: number;
}

const HEADER_RE = /^traceroute to \S+ \([^)]+\), \d+ hops max/;

/** Globalping result → traceroute output lines the existing parser understands. */
export function toTracerouteLines(target: string, result: GpResult): string[] {
  const first = result.rawOutput.split("\n")[0]?.trim() ?? "";
  const header = HEADER_RE.test(first)
    ? first
    : `traceroute to ${target} (${result.resolvedAddress ?? target}), 30 hops max`;
  const hops = result.hops.map((hop, i) => {
    const n = String(i + 1).padStart(2);
    const rtts = hop.timings.flatMap((t) => (typeof t.rtt === "number" ? [`${t.rtt} ms`] : []));
    if (!hop.resolvedAddress || rtts.length === 0) return `${n}  * * *`;
    return `${n}  ${hop.resolvedAddress}  ${rtts.join("  ")}`;
  });
  return [header, ...hops];
}

const regionName = (code: string) => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** The probe, described as the trace origin. */
export function probeToGeo(probe: GpProbe): GeoInfo {
  return {
    ip: "",
    lat: probe.latitude,
    lon: probe.longitude,
    city: probe.city || null,
    region: probe.state ?? null,
    country: displayCountry(regionName(probe.country)),
    countryCode: probe.country,
    timezone: null,
    isp: probe.network || null,
    org: null,
    asn: probe.asn ? `AS${probe.asn}` : null,
    asName: probe.network || null,
  };
}

/** First line of a third-party error, without control characters and capped, so it is safe to show. */
function cleanReason(rawOutput: string): string {
  return (rawOutput.split("\n")[0] ?? "")
    .replace(/^traceroute:\s*/i, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 120);
}

const minutes = (seconds: number) => {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m === 1 ? "a minute" : `about ${m} minutes`;
};

async function failure(res: Response): Promise<GlobalpingError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { type?: string; message?: string; params?: Record<string, string> };
  } | null;
  if (res.status === 429) {
    const reset = Number(res.headers.get("x-ratelimit-reset") ?? res.headers.get("retry-after") ?? 3600);
    return new GlobalpingError(
      `The remote tracing network's hourly limit is used up. Try again in ${minutes(reset)}.`,
      429,
    );
  }
  if (body?.error?.type === "no_probes_found" || /no suitable probes/i.test(body?.error?.message ?? "")) {
    return new GlobalpingError("No probe is online in that location right now. Pick another one.", res.status);
  }
  // Validation errors explain themselves per field (e.g. private targets); pass that on, cleaned.
  const detail = Object.values(body?.error?.params ?? {}).find((v) => typeof v === "string");
  if (detail) return new GlobalpingError(`The remote tracing network refused the request: ${cleanReason(detail)}`, res.status);
  return new GlobalpingError(`The remote tracing network refused the request (HTTP ${res.status}).`, res.status);
}

export interface GlobalpingOptions {
  fetchImpl?: typeof fetch;
  token?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  timeoutMs?: number;
}

export function createGlobalpingClient({
  fetchImpl = fetch,
  token,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollMs = 500,
  timeoutMs = 30_000,
}: GlobalpingOptions = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;

  async function traceroute({
    target,
    location,
    signal,
  }: {
    target: string;
    location: GpLocation;
    signal: AbortSignal;
  }): Promise<{ probe: GpProbe; result: GpResult }> {
    const created = await fetchImpl(API, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "traceroute",
        target,
        locations: [location],
        limit: 1,
        measurementOptions: { protocol: "ICMP" },
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    if (!created.ok) {
      const error = await failure(created);
      error.notStarted = true;
      throw error;
    }
    const { id } = (await created.json()) as { id: string };

    const startedAt = now();
    while (true) {
      if (signal.aborted) throw new Error("aborted");
      if (now() - startedAt > timeoutMs) throw new GlobalpingError("The remote trace took too long. Try again.");
      await sleep(pollMs);
      if (signal.aborted) throw new Error("aborted");
      const res = await fetchImpl(`${API}/${encodeURIComponent(id)}`, {
        headers,
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (!res.ok) throw await failure(res);
      const body = (await res.json()) as { status: string; results: Array<{ probe: GpProbe; result: GpResult }> };
      if (body.status === "in-progress") continue;
      const first = body.results[0];
      if (!first) throw new GlobalpingError("No probe answered for that location. Pick another one.");
      if (first.result.status !== "finished") {
        const reason = cleanReason(first.result.rawOutput);
        throw new GlobalpingError(reason ? `The remote trace failed: ${reason}` : "The remote trace failed.");
      }
      return first;
    }
  }

  return { traceroute };
}

export const globalping = createGlobalpingClient({ token: process.env.GLOBALPING_TOKEN || undefined });
