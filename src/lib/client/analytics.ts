/**
 * Google Analytics 4 wiring. The measurement ids come from the build-time
 * `NEXT_PUBLIC_GA_IDS` list; without it no script loads and `track()` does
 * nothing, so local and preview builds never report. Every custom event goes
 * through `track()`: no other module calls gtag.
 */

export type AnalyticsValue = string | number | boolean;
export type AnalyticsParams = Record<string, AnalyticsValue | null | undefined>;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

const MEASUREMENT_ID_RE = /^G-[A-Z0-9]+$/i;
const MAX_STRING_LENGTH = 100;

/** Comma-separated GA4 measurement ids, trimmed and deduplicated; anything else is dropped. */
export function parseGaIds(raw: string | undefined): string[] {
  const ids = (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => MEASUREMENT_ID_RE.test(id));
  return [...new Set(ids)];
}

/**
 * Inline bootstrap that runs next to gtag.js: one `config` per id. Page views
 * come from the default config and enhanced measurement (including History API
 * route changes), so no manual `page_view` is sent. `cookie_domain` stays on its
 * `auto` default so one visitor keeps one client id across subdomains.
 */
export function gaInitScript(ids: string[]): string {
  const configs = ids.map((id) => `gtag('config',${JSON.stringify(id)});`).join("");
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());${configs}`;
}

/** Sends a custom event. Never throws; a no-op when gtag is absent (no ids, blocked, or on the server). */
export function track(name: string, params: AnalyticsParams = {}): void {
  try {
    if (typeof window === "undefined" || typeof window.gtag !== "function") return;
    const clean: Record<string, AnalyticsValue> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue;
      clean[key] = typeof value === "string" ? value.slice(0, MAX_STRING_LENGTH) : value;
    }
    window.gtag("event", name, clean);
  } catch {
    // Analytics must never break the page.
  }
}
