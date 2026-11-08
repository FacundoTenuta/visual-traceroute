import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

const SYSTEM_PATHS = ["/usr/sbin/traceroute", "/usr/bin/traceroute", "/sbin/traceroute", "/bin/traceroute", "/usr/local/bin/traceroute"];

/** First executable `traceroute` on PATH or in the usual system folders, else null. */
export async function findTraceroute(pathEnv = process.env.PATH ?? "", extra = SYSTEM_PATHS): Promise<string | null> {
  const candidates = [...pathEnv.split(delimiter).filter(Boolean).map((dir) => join(dir, "traceroute")), ...extra];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

let cached: Promise<boolean> | null = null;

/**
 * Whether this server can run the system traceroute. False on serverless hosts
 * such as Vercel (no binary); TRACE_LOCAL=0 turns local traces off explicitly.
 */
export function isLocalTraceAvailable(): Promise<boolean> {
  if (process.env.TRACE_LOCAL === "0") return Promise.resolve(false);
  cached ??= findTraceroute().then((path) => path !== null);
  return cached;
}
