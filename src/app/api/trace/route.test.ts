import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnTraceroute = vi.fn();
vi.mock("@/lib/traceroute/spawn", () => ({ spawnTraceroute }));
vi.mock("@/lib/geo/ip-api", () => ({
  ipApi: { geolocate: vi.fn(async () => null), origin: vi.fn(async () => null) },
}));
vi.mock("@/lib/geo/reverse-dns", () => ({ reverseDns: vi.fn(async () => null) }));
const localAvailable = vi.fn(async () => true);
vi.mock("@/lib/traceroute/available", () => ({ isLocalTraceAvailable: localAvailable }));
const findLocation = vi.fn();
vi.mock("@/lib/globalping/catalog", () => ({ probeCatalog: { find: findLocation, locations: vi.fn(async () => []) } }));
const remoteTraceroute = vi.fn();
vi.mock("@/lib/globalping/measure", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/globalping/measure")>()),
  globalping: { traceroute: remoteTraceroute },
}));

const { GET } = await import("./route");
const { traceLimiter } = await import("@/lib/traceroute/limiter");

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

describe("GET /api/trace limits", () => {
  const untilAborted = (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });

  function hangingSource(signal: AbortSignal, hops: string[] = []) {
    async function* lines() {
      yield { stream: "stderr" as const, line: "traceroute to 1.1.1.1 (1.1.1.1), 30 hops max, 40 byte packets" };
      for (const line of hops) yield { stream: "stdout" as const, line };
      await untilAborted(signal);
    }
    return { lines: lines(), exit: untilAborted(signal).then(() => null) };
  }

  const open = (headers: Record<string, string> = {}) => {
    const controller = new AbortController();
    const request = new Request("http://localhost/api/trace?target=1.1.1.1", { headers, signal: controller.signal });
    return { controller, response: GET(request) };
  };

  /** Waits until every trace has released its slot (no fixed sleeps). */
  const waitForIdle = () => vi.waitFor(() => expect(traceLimiter.active).toBe(0));

  beforeEach(() => {
    expect(traceLimiter.active).toBe(0);
    spawnTraceroute.mockReset();
    spawnTraceroute.mockImplementation((_target: string, signal: AbortSignal) => hangingSource(signal));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("with TRUST_PROXY=1, limits concurrent traces per forwarded client", async () => {
    vi.stubEnv("TRUST_PROXY", "1");
    const a = { "x-forwarded-for": "198.51.100.1" };
    const first = open(a);
    const second = open(a);
    expect((await first.response).status).toBe(200);
    expect((await second.response).status).toBe(200);

    const third = await open(a).response;
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({
      error: "You already have 2 traces running. Stop one or wait for it to finish.",
    });

    const other = open({ "x-forwarded-for": "198.51.100.2" });
    expect((await other.response).status).toBe(200);

    first.controller.abort();
    second.controller.abort();
    other.controller.abort();
    await waitForIdle();
    const again = open(a);
    expect((await again.response).status).toBe(200);
    again.controller.abort();
    await waitForIdle();
  });

  it("without TRUST_PROXY, ignores forwarding headers and applies only the global cap", async () => {
    // Three traces from the same forwarded client: a per-client cap of 2 would reject the third.
    const same = { "x-forwarded-for": "198.51.100.1" };
    const traces = [open(same), open(same), open(same)];
    for (const trace of traces) expect((await trace.response).status).toBe(200);

    const fourth = await open({ "x-forwarded-for": "203.0.113.9" }).response;
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: "Too many traces running. Try again in a moment." });

    traces.forEach((trace) => trace.controller.abort());
    await waitForIdle();
  });

  it("with TRUST_PROXY=1, falls back to X-Real-IP when X-Forwarded-For is missing", async () => {
    vi.stubEnv("TRUST_PROXY", "1");
    const real = { "x-real-ip": " 203.0.113.5 " };
    const traces = [open(real), open({ "x-real-ip": "203.0.113.5" })];
    for (const trace of traces) expect((await trace.response).status).toBe(200);
    const third = await open(real).response;
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({
      error: "You already have 2 traces running. Stop one or wait for it to finish.",
    });
    traces.forEach((trace) => trace.controller.abort());
    await waitForIdle();
  });

  it("with TRUST_PROXY=1 but no forwarding headers, applies only the global cap", async () => {
    vi.stubEnv("TRUST_PROXY", "1");
    const traces = [open(), open(), open()];
    for (const trace of traces) expect((await trace.response).status).toBe(200);
    traces.forEach((trace) => trace.controller.abort());
    await waitForIdle();
  });

  it("stops a trace after 150 seconds, ends the stream with done and frees the slot", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    spawnTraceroute.mockImplementation((_target: string, signal: AbortSignal) =>
      hangingSource(signal, [" 1  1.1.1.1  4.2 ms"]),
    );

    const traces = [open(), open(), open()];
    const responses = await Promise.all(traces.map((t) => t.response));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect((await open().response).status).toBe(429);

    const bodies = responses.map((r) => r.text());
    await vi.advanceTimersByTimeAsync(149_999);
    expect(spawnTraceroute.mock.calls.every(([, signal]) => !(signal as AbortSignal).aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    for (const body of await Promise.all(bodies)) {
      const last = JSON.parse(body.trim().split("\n\n").at(-1)!.replace(/^data: /, ""));
      expect(last).toMatchObject({ type: "done", hops: 1 });
    }
    expect(traceLimiter.active).toBe(0);
    const after = open();
    expect((await after.response).status).toBe(200);
    after.controller.abort();
    vi.useRealTimers();
    await waitForIdle();
  });
});

describe("GET /api/trace from a remote location", () => {
  const MADRID = {
    id: "es-madrid",
    city: "Madrid",
    country: "ES",
    continent: "EU",
    lat: 40.42,
    lon: -3.7,
    probes: 4,
    networks: [{ asn: 8560, network: "IONOS SE", probes: 3 }],
  };
  const probe = { country: "ES", city: "Madrid", asn: 8560, network: "IONOS SE", latitude: 40.42, longitude: -3.7 };
  const result = {
    status: "finished",
    rawOutput: "traceroute to cloudflare.com (104.16.133.229), 20 hops max, 60 byte packets",
    resolvedAddress: "104.16.133.229",
    resolvedHostname: "cloudflare.com",
    hops: [
      { resolvedAddress: "212.227.121.218", resolvedHostname: null, timings: [{ rtt: 0.8 }] },
      { resolvedAddress: null, resolvedHostname: null, timings: [] },
      { resolvedAddress: "104.16.133.229", resolvedHostname: "cloudflare.com", timings: [{ rtt: 10.6 }] },
    ],
  };
  const events = async (res: Response) =>
    (await res.text())
      .split("\n\n")
      .filter(Boolean)
      .map((chunk) => JSON.parse(chunk.replace(/^data: /, "")));

  beforeEach(() => {
    findLocation.mockReset();
    remoteTraceroute.mockReset();
    spawnTraceroute.mockReset();
  });

  it("traces from the chosen location and reports the probe as the origin", async () => {
    findLocation.mockResolvedValue(MADRID);
    remoteTraceroute.mockResolvedValue({ probe, result });
    const res = await GET(new Request("http://localhost/api/trace?target=cloudflare.com&from=es-madrid"));
    expect(res.status).toBe(200);
    const list = await events(res);
    expect(list[0]).toEqual({ type: "start", target: "cloudflare.com", ip: "104.16.133.229", maxHops: 20 });
    expect(list).toContainEqual({ type: "origin", geo: expect.objectContaining({ city: "Madrid", lat: 40.42, isp: "IONOS SE" }) });
    expect(list.filter((e) => e.type === "hop").at(-1).hop.hop).toBe(3);
    expect(list.at(-1)).toMatchObject({ type: "done", hops: 3, reached: true });
    expect(remoteTraceroute.mock.calls[0][0]).toMatchObject({
      target: "cloudflare.com",
      location: { country: "ES", city: "Madrid" },
    });
    expect(spawnTraceroute).not.toHaveBeenCalled();
  });

  it("can pin a network inside the chosen city", async () => {
    findLocation.mockResolvedValue(MADRID);
    remoteTraceroute.mockResolvedValue({ probe, result });
    await (await GET(new Request("http://localhost/api/trace?target=cloudflare.com&from=es-madrid&asn=8560"))).text();
    expect(remoteTraceroute.mock.calls[0][0].location).toEqual({ country: "ES", city: "Madrid", asn: 8560 });
  });

  it("rejects an origin that is not in the probe catalog", async () => {
    findLocation.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/trace?target=cloudflare.com&from=xx-nowhere"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown trace origin. Pick a location from the list." });
    expect(remoteTraceroute).not.toHaveBeenCalled();
  });

  it("rejects a network that has no probes in that city", async () => {
    findLocation.mockResolvedValue(MADRID);
    const res = await GET(new Request("http://localhost/api/trace?target=cloudflare.com&from=es-madrid&asn=3352"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That network has no probes in Madrid." });
  });

  it("streams the remote service's error as a readable message", async () => {
    const { GlobalpingError } = await import("@/lib/globalping/measure");
    findLocation.mockResolvedValue(MADRID);
    remoteTraceroute.mockRejectedValue(
      new GlobalpingError("The remote tracing network's hourly limit is used up. Try again in about 30 minutes.", 429),
    );
    const list = await events(await GET(new Request("http://localhost/api/trace?target=cloudflare.com&from=es-madrid")));
    expect(list).toEqual([
      { type: "error", message: "The remote tracing network's hourly limit is used up. Try again in about 30 minutes." },
    ]);
  });

  it("rejects a network without a location instead of ignoring it", async () => {
    const res = await GET(new Request("http://localhost/api/trace?target=127.0.0.1&asn=8560"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Pick a location before choosing a network." });
    expect(spawnTraceroute).not.toHaveBeenCalled();
  });

  it("says the location list is unavailable when it cannot be loaded", async () => {
    findLocation.mockRejectedValue(new Error("down"));
    const res = await GET(new Request("http://localhost/api/trace?target=cloudflare.com&from=es-madrid"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Remote locations are unavailable right now. Try again in a minute." });
  });

  it("asks for a location when this server cannot trace locally", async () => {
    localAvailable.mockResolvedValueOnce(false);
    const res = await GET(new Request("http://localhost/api/trace?target=cloudflare.com"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This server can't run traceroute. Pick a location to trace from." });
  });
});
