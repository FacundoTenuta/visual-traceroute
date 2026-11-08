import { describe, expect, it } from "vitest";
import { GlobalpingError } from "@/lib/globalping/measure";
import { remoteLineSource } from "./remote";

async function drain(source: ReturnType<typeof remoteLineSource>) {
  const lines = [];
  for await (const line of source.lines) lines.push(line);
  return { lines, exit: await source.exit };
}

describe("remoteLineSource", () => {
  it("emits the header on stderr and hops on stdout", async () => {
    const { lines, exit } = await drain(remoteLineSource(async () => ["traceroute to x (1.1.1.1), 30 hops max", " 1  1.1.1.1  1 ms"], new AbortController().signal));
    expect(lines).toEqual([
      { stream: "stderr", line: "traceroute to x (1.1.1.1), 30 hops max" },
      { stream: "stdout", line: " 1  1.1.1.1  1 ms" },
    ]);
    expect(exit).toBe(0);
  });

  it("reports remote errors as a traceroute error line", async () => {
    const { lines, exit } = await drain(remoteLineSource(async () => Promise.reject(new GlobalpingError("No probe is online.")), new AbortController().signal));
    expect(lines).toEqual([{ stream: "stderr", line: "traceroute: No probe is online." }]);
    expect(exit).toBe(1);
  });

  it("ends quietly when the trace was cancelled, whatever error the abort produced", async () => {
    const controller = new AbortController();
    controller.abort();
    const { lines, exit } = await drain(
      remoteLineSource(async () => Promise.reject(new DOMException("The operation was aborted.", "AbortError")), controller.signal),
    );
    expect(lines).toEqual([]);
    expect(exit).toBeNull();
  });
});
