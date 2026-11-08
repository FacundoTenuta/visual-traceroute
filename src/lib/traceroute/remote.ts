import { GlobalpingError } from "@/lib/globalping/measure";
import type { LineSource } from "./session";

/**
 * Wraps a remote measurement as a LineSource, so the same parser, enrichment
 * and event stream serve local and remote traces. The header goes to stderr
 * and hops to stdout, as the system traceroute does.
 */
export function remoteLineSource(run: () => Promise<string[]>): LineSource {
  let resolveExit: (code: number | null) => void = () => {};
  const exit = new Promise<number | null>((resolve) => (resolveExit = resolve));

  async function* lines() {
    try {
      const [header, ...hops] = await run();
      yield { stream: "stderr" as const, line: header };
      for (const line of hops) yield { stream: "stdout" as const, line };
      resolveExit(0);
    } catch (error) {
      if (error instanceof Error && error.message === "aborted") {
        resolveExit(null);
        return;
      }
      const message = error instanceof GlobalpingError ? error.message : "The remote trace failed. Try again.";
      yield { stream: "stderr" as const, line: `traceroute: ${message}` };
      resolveExit(1);
    }
  }

  return { lines: lines(), exit };
}
