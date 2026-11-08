import { access, constants } from "node:fs/promises";

const CANDIDATES = ["/usr/sbin/traceroute", "/usr/bin/traceroute", "/sbin/traceroute", "/bin/traceroute", "/usr/local/bin/traceroute"];
let cached: Promise<boolean> | null = null;

/**
 * Whether this server can run the system traceroute. False on serverless hosts
 * such as Vercel (no binary); TRACE_LOCAL=0 turns local traces off explicitly.
 */
export function isLocalTraceAvailable(): Promise<boolean> {
  if (process.env.TRACE_LOCAL === "0") return Promise.resolve(false);
  cached ??= Promise.any(CANDIDATES.map((path) => access(path, constants.X_OK))).then(
    () => true,
    () => false,
  );
  return cached;
}
