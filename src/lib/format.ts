export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
}

export function formatKm(km: number): string {
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

export function formatLoss(loss: number): string {
  return `${Math.round(loss * 100)}%`;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Converts an ISO 3166-1 alpha-2 code into its flag emoji. */
export function flag(countryCode: string | null | undefined): string {
  if (!countryCode || !/^[a-z]{2}$/i.test(countryCode)) return "";
  return String.fromCodePoint(...[...countryCode.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
