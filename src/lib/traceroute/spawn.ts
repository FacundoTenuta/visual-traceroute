import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { LineSource } from "./session";

export const MAX_HOPS = 30;

/**
 * Runs the system traceroute. `target` must already be validated by
 * `validateTarget`; it is passed after `--` in an argument array (no shell),
 * so it can never be read as an option or a command.
 */
export function spawnTraceroute(target: string, signal: AbortSignal): LineSource {
  const child = spawn(
    "traceroute",
    ["-n", "-q", "3", "-w", "2", "-m", String(MAX_HOPS), "--", target],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PATH: `/usr/sbin:/usr/bin:/sbin:/bin:${process.env.PATH ?? ""}` } },
  );

  const kill = () => child.kill("SIGTERM");
  // An abort that already happened never fires its event, so check it first.
  if (signal.aborted) kill();
  else signal.addEventListener("abort", kill, { once: true });

  const exit = new Promise<number | null>((resolve) => {
    child.on("error", () => resolve(127));
    child.on("close", (code) => {
      signal.removeEventListener("abort", kill);
      resolve(code);
    });
  });

  async function* lines() {
    const queue: Array<{ stream: "stdout" | "stderr"; line: string }> = [];
    let wake: (() => void) | null = null;
    let open = 2;
    const notify = () => {
      wake?.();
      wake = null;
    };
    for (const [stream, input] of [
      ["stdout", child.stdout],
      ["stderr", child.stderr],
    ] as const) {
      const rl = createInterface({ input });
      rl.on("line", (line) => {
        queue.push({ stream, line });
        notify();
      });
      rl.on("close", () => {
        open--;
        notify();
      });
    }
    child.on("error", (err) => {
      queue.push({ stream: "stderr", line: `traceroute: ${err.message}` });
      open = 0;
      notify();
    });

    while (true) {
      if (queue.length) {
        yield queue.shift()!;
      } else if (open <= 0) {
        return;
      } else {
        await new Promise<void>((resolve) => (wake = resolve));
      }
    }
  }

  return { lines: lines(), exit };
}
