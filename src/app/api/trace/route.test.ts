import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnTraceroute = vi.fn();
vi.mock("@/lib/traceroute/spawn", () => ({ spawnTraceroute }));
vi.mock("@/lib/geo/ip-api", () => ({
  ipApi: { geolocate: vi.fn(async () => null), origin: vi.fn(async () => null) },
}));
vi.mock("@/lib/geo/reverse-dns", () => ({ reverseDns: vi.fn(async () => null) }));

const { GET } = await import("./route");

function fakeSource(stdout: string[]) {
  async function* lines() {
    yield { stream: "stderr" as const, line: "traceroute to 1.1.1.1 (1.1.1.1), 30 hops max, 40 byte packets" };
    for (const line of stdout) yield { stream: "stdout" as const, line };
  }
  return { lines: lines(), exit: Promise.resolve(0) };
}

describe("GET /api/trace", () => {
  beforeEach(() => spawnTraceroute.mockReset());

  it("rejects invalid targets with 400 and never spawns traceroute", async () => {
    const res = await GET(new Request("http://localhost/api/trace?target=-m%201%20x;id"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid hostname or IPv4 address." });
    expect(spawnTraceroute).not.toHaveBeenCalled();
  });

  it("rejects a missing target", async () => {
    const res = await GET(new Request("http://localhost/api/trace"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Enter a hostname or IPv4 address." });
  });

  it("streams server-sent events for a valid target", async () => {
    spawnTraceroute.mockReturnValue(fakeSource([" 1  1.1.1.1  4.2 ms"]));
    const res = await GET(new Request("http://localhost/api/trace?target=https://1.1.1.1/"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(spawnTraceroute.mock.calls[0][0]).toBe("1.1.1.1");

    const events = (await res.text())
      .split("\n\n")
      .filter(Boolean)
      .map((chunk) => JSON.parse(chunk.replace(/^data: /, "")));
    expect(events[0]).toEqual({ type: "start", target: "1.1.1.1", ip: "1.1.1.1", maxHops: 30 });
    expect(events.at(-1)).toMatchObject({ type: "done", hops: 1, reached: true });
  });
});
