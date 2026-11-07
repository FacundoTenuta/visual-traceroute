import { promises as dns } from "node:dns";

const TIMEOUT_MS = 1500;

export async function reverseDns(ip: string): Promise<string | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS).unref());
  const lookup = dns
    .reverse(ip)
    .then((names) => names[0] ?? null)
    .catch(() => null);
  return Promise.race([lookup, timeout]);
}
