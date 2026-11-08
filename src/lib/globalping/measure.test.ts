import { describe, expect, it, vi } from "vitest";
import { createGlobalpingClient, GlobalpingError, probeToGeo, toTracerouteLines, type GpResult } from "./measure";

const probe = {
  continent: "EU",
  country: "ES",
  city: "Madrid",
  asn: 8560,
  network: "IONOS SE",
  latitude: 40.42,
  longitude: -3.7,
};

const finished: GpResult = {
  status: "finished",
  rawOutput: "traceroute to cloudflare.com (104.16.133.229), 20 hops max, 60 byte packets\n 1  ...",
  resolvedAddress: "104.16.133.229",
  resolvedHostname: "cloudflare.com",
  hops: [
    { resolvedAddress: "169.254.0.2", resolvedHostname: "_gateway", timings: [{ rtt: 0.556 }] },
    { resolvedAddress: null, resolvedHostname: null, timings: [] },
    { resolvedAddress: "104.16.133.229", resolvedHostname: "cloudflare.com", timings: [{ rtt: 10.593 }, { rtt: 10.631 }] },
  ],
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("toTracerouteLines", () => {
  it("turns a Globalping result into traceroute output the existing parser understands", () => {
    expect(toTracerouteLines("cloudflare.com", finished)).toEqual([
      "traceroute to cloudflare.com (104.16.133.229), 20 hops max, 60 byte packets",
      " 1  169.254.0.2  0.556 ms",
      " 2  * * *",
      " 3  104.16.133.229  10.593 ms  10.631 ms",
    ]);
  });

  it("builds a header when the raw output has none", () => {
    const lines = toTracerouteLines("example.com", { ...finished, rawOutput: "" });
    expect(lines[0]).toBe("traceroute to example.com (104.16.133.229), 30 hops max");
  });
});

describe("probeToGeo", () => {
  it("describes the probe as the trace origin", () => {
    expect(probeToGeo(probe)).toMatchObject({
      lat: 40.42,
      lon: -3.7,
      city: "Madrid",
      countryCode: "ES",
      asn: "AS8560",
      isp: "IONOS SE",
    });
  });
});

describe("createGlobalpingClient", () => {
  const location = { country: "ES", city: "Madrid" };

  it("creates a traceroute measurement and polls until it finishes", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: "m1", probesCount: 1 }, 202))
      .mockResolvedValueOnce(json({ status: "in-progress", results: [] }))
      .mockResolvedValueOnce(json({ status: "finished", results: [{ probe, result: finished }] }));
    const client = createGlobalpingClient({ fetchImpl, sleep: async () => {} });
    const out = await client.traceroute({ target: "cloudflare.com", location, signal: new AbortController().signal });
    expect(out.probe.city).toBe("Madrid");
    expect(out.result.hops).toHaveLength(3);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.globalping.io/v1/measurements");
    expect(JSON.parse(String(init?.body))).toEqual({
      type: "traceroute",
      target: "cloudflare.com",
      locations: [location],
      limit: 1,
      measurementOptions: { protocol: "ICMP" },
    });
    expect(String(fetchImpl.mock.calls[2][0])).toBe("https://api.globalping.io/v1/measurements/m1");
  });

  it("sends the token when one is configured", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: "m1" }, 202))
      .mockResolvedValueOnce(json({ status: "finished", results: [{ probe, result: finished }] }));
    const client = createGlobalpingClient({ fetchImpl, token: "secret", sleep: async () => {} });
    await client.traceroute({ target: "x.com", location, signal: new AbortController().signal });
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer secret");
  });

  it("explains when the hourly limit is used up", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ error: { message: "Too many" } }, 429, { "x-ratelimit-reset": "1800" }));
    const client = createGlobalpingClient({ fetchImpl, sleep: async () => {} });
    await expect(client.traceroute({ target: "x.com", location, signal: new AbortController().signal })).rejects.toEqual(
      // Refused at creation: nothing ran, so the visitor's own quota is refunded upstream.
      new GlobalpingError("The remote tracing network's hourly limit is used up. Try again in about 30 minutes.", 429, true),
    );
  });

  it("passes on why Globalping refused the target", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      json({ error: { type: "validation_error", message: "Parameter validation failed.", params: { target: "Private hostnames are not allowed.\u0007" } } }, 400),
    );
    const client = createGlobalpingClient({ fetchImpl, sleep: async () => {} });
    await expect(client.traceroute({ target: "127.0.0.1", location, signal: new AbortController().signal })).rejects.toThrow(
      "The remote tracing network refused the request: Private hostnames are not allowed.",
    );
  });

  it("reports when no probe matches the location", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ error: { type: "no_probes_found", message: "No suitable probes" } }, 422));
    const client = createGlobalpingClient({ fetchImpl, sleep: async () => {} });
    await expect(client.traceroute({ target: "x.com", location, signal: new AbortController().signal })).rejects.toThrow(
      "No probe is online in that location right now. Pick another one.",
    );
  });

  it("cleans the remote failure reason before showing it", async () => {
    const failed = { ...finished, status: "failed" as const, rawOutput: `traceroute: unknown host \u001b[31mevil\u0007 ${"x".repeat(300)}` };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ id: "m1" }, 202))
      .mockResolvedValueOnce(json({ status: "finished", results: [{ probe, result: failed }] }));
    const client = createGlobalpingClient({ fetchImpl, sleep: async () => {} });
    const error = await client.traceroute({ target: "x.com", location, signal: new AbortController().signal }).catch((e) => e);
    expect(error.message.startsWith("The remote trace failed: unknown host [31mevil ")).toBe(true);
    expect(error.message).not.toMatch(/[\u0000-\u001f]/);
    expect(error.message.length).toBeLessThanOrEqual(150);
  });

  it("gives up when the measurement takes too long", async () => {
    let t = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/measurements") ? json({ id: "m1" }, 202) : json({ status: "in-progress", results: [] }),
    );
    const client = createGlobalpingClient({ fetchImpl, now: () => t, sleep: async () => void (t += 5000), timeoutMs: 20_000 });
    await expect(client.traceroute({ target: "x.com", location, signal: new AbortController().signal })).rejects.toThrow(
      "The remote trace took too long. Try again.",
    );
  });

  it("stops polling when the caller aborts", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/measurements") ? json({ id: "m1" }, 202) : json({ status: "in-progress", results: [] }),
    );
    const client = createGlobalpingClient({ fetchImpl, sleep: async () => controller.abort() });
    await expect(client.traceroute({ target: "x.com", location, signal: controller.signal })).rejects.toThrow("aborted");
  });
});
