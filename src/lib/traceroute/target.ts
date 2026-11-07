import { isIPv4, looksLikeIPv6 } from "@/lib/net/ip";

export type TargetResult = { ok: true; value: string } | { ok: false; error: string };

const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const MAX_HOSTNAME_LENGTH = 253;

function extractHost(input: string): string {
  if (!input.includes("://")) return input;
  try {
    return new URL(input).hostname;
  } catch {
    return input;
  }
}

function isHostname(value: string): boolean {
  if (value.length > MAX_HOSTNAME_LENGTH) return false;
  const labels = value.split(".");
  // A purely numeric dotted value must be a valid IPv4 literal, not a hostname.
  if (labels.every((label) => /^\d+$/.test(label))) return false;
  return labels.every((label) => LABEL_RE.test(label));
}

/**
 * Normalizes user input into a traceroute target. The result is always a bare
 * hostname or IPv4 literal, so it can never be interpreted as a CLI option.
 */
export function validateTarget(raw: string): TargetResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Enter a hostname or IPv4 address." };

  const host = extractHost(trimmed).toLowerCase().replace(/\.$/, "");
  const bare = host.replace(/^\[|\]$/g, "");

  if (looksLikeIPv6(bare)) return { ok: false, error: "IPv6 targets are not supported yet." };
  if (isIPv4(host) || isHostname(host)) return { ok: true, value: host };
  return { ok: false, error: "Invalid hostname or IPv4 address." };
}
