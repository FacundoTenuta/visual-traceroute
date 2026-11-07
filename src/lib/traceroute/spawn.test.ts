import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => {
    this.stdout.end();
    this.stderr.end();
    queueMicrotask(() => this.emit("close", null));
    return true;
  });
}

const children: FakeChild[] = [];
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  }),
}));

const { spawnTraceroute } = await import("./spawn");
const { spawn } = await import("node:child_process");

describe("spawnTraceroute", () => {
  it("passes the target after -- with no shell", () => {
    spawnTraceroute("example.com", new AbortController().signal);
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[0]).toBe("traceroute");
    expect(vi.mocked(spawn).mock.calls.at(-1)?.[1]).toEqual(["-n", "-q", "3", "-w", "2", "-m", "30", "--", "example.com"]);
  });

  it("kills the process when the signal aborts later", async () => {
    const controller = new AbortController();
    const source = spawnTraceroute("example.com", controller.signal);
    controller.abort();
    expect(children.at(-1)?.kill).toHaveBeenCalledWith("SIGTERM");
    expect(await source.exit).toBeNull();
  });

  it("kills the process right away when the signal was already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const source = spawnTraceroute("example.com", controller.signal);
    expect(children.at(-1)?.kill).toHaveBeenCalledWith("SIGTERM");
    expect(await source.exit).toBeNull();
  });
});
