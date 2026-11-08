import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findTraceroute } from "./available";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "vt-path-"));
  await writeFile(join(dir, "traceroute"), "#!/bin/sh\n");
  await chmod(join(dir, "traceroute"), 0o755);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("findTraceroute", () => {
  it("finds traceroute anywhere on PATH, not only in the usual system folders", async () => {
    expect(await findTraceroute(`/nonexistent:${dir}`, [])).toBe(join(dir, "traceroute"));
  });

  it("returns null when it is nowhere to be found", async () => {
    expect(await findTraceroute("/nonexistent", ["/also/missing/traceroute"])).toBeNull();
  });
});
