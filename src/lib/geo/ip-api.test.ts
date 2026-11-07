import { describe, expect, it, vi } from "vitest";
import { createIpApiClient } from "./ip-api";

const okBody = {
  status: "success",
  query: "8.8.8.8",
  country: "United States",
  countryCode: "US",
  regionName: "Virginia",
  city: "Ashburn",
  lat: 39.03,
  lon: -77.5,
  timezone: "America/New_York",
  isp: "Google LLC",
  org: "Google Public DNS",
  as: "AS15169 Google LLC",
  asname: "GOOGLE",
};

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-rl": "44", "x-ttl": "60", ...headers },
  });
}

function setup(fetchImpl: typeof fetch, options: { apiKey?: string; maxPerMinute?: number } = {}) {
  const clock = { now: 0 };
  const client = createIpApiClient({ fetchImpl, now: () => clock.now, apiKey: options.apiKey, maxPerMinute: options.maxPerMinute });
  return { client, clock };
}

const url = (fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>, call = 0) => String(fetchImpl.mock.calls[call][0]);

describe("createIpApiClient", () => {
  it("maps ip-api fields into GeoInfo", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(okBody));
    const { client } = setup(fetchImpl);
    expect(await client.geolocate("8.8.8.8")).toEqual({
      ip: "8.8.8.8",
      lat: 39.03,
      lon: -77.5,
      city: "Ashburn",
      region: "Virginia",
      country: "United States",
      countryCode: "US",
      timezone: "America/New_York",
      isp: "Google LLC",
      org: "Google Public DNS",
      asn: "AS15169",
      asName: "GOOGLE",
    });
    expect(url(fetchImpl)).toMatch(/^http:\/\/ip-api\.com\/json\/8\.8\.8\.8\?fields=/);
  });

  it("uses the HTTPS pro endpoint when an API key is configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(okBody));
    const { client } = setup(fetchImpl, { apiKey: "k3y" });
    await client.geolocate("8.8.8.8");
    expect(url(fetchImpl)).toMatch(/^https:\/\/pro\.ip-api\.com\/json\/8\.8\.8\.8\?fields=.*&key=k3y$/);
  });

  it("caches successful lookups per address", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(okBody));
    const { client } = setup(fetchImpl);
    await client.geolocate("8.8.8.8");
    await client.geolocate("8.8.8.8");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("expires cached lookups after a day", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(okBody));
    const { client, clock } = setup(fetchImpl);
    await client.geolocate("8.8.8.8");
    clock.now = 24 * 60 * 60 * 1000;
    await client.geolocate("8.8.8.8");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("remembers addresses ip-api cannot locate for a while instead of asking again", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response({ status: "fail", message: "reserved range", query: "10.0.0.1" }));
    const { client, clock } = setup(fetchImpl);
    expect(await client.geolocate("10.0.0.1")).toBeNull();
    expect(await client.geolocate("10.0.0.1")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock.now = 5 * 60 * 1000;
    await client.geolocate("10.0.0.1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops calling ip-api after a 429 until the advertised wait has passed", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({}, 429, { "x-rl": "0", "x-ttl": "30" }))
      .mockResolvedValue(response(okBody));
    const { client, clock } = setup(fetchImpl);
    expect(await client.geolocate("8.8.8.8")).toBeNull();
    expect(await client.geolocate("9.9.9.9")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock.now = 30_000;
    expect(await client.geolocate("8.8.8.8")).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("pauses when ip-api reports the quota is used up", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(okBody, 200, { "x-rl": "0", "x-ttl": "20" }));
    const { client, clock } = setup(fetchImpl);
    expect(await client.geolocate("8.8.8.8")).not.toBeNull();
    expect(await client.geolocate("9.9.9.9")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock.now = 20_000;
    await client.geolocate("9.9.9.9");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps its own request rate under the per-minute budget", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      response({ ...okBody, query: String(input).split("/json/")[1].split("?")[0] }),
    );
    const { client, clock } = setup(fetchImpl, { maxPerMinute: 3 });
    for (const ip of ["1.0.0.1", "1.0.0.2", "1.0.0.3", "1.0.0.4"]) await client.geolocate(ip);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    clock.now = 60_000;
    expect(await client.geolocate("1.0.0.4")).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("sanitizes provider fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      response({ ...okBody, city: `  ${"x".repeat(500)}  `, countryCode: "<b>", asname: 42 }),
    );
    const { client } = setup(fetchImpl);
    const geo = await client.geolocate("8.8.8.8");
    expect(geo?.city).toHaveLength(120);
    expect(geo?.countryCode).toBeNull();
    expect(geo?.asName).toBeNull();
  });

  it("rejects out-of-range coordinates", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response({ ...okBody, lat: 123 }));
    const { client } = setup(fetchImpl);
    expect(await client.geolocate("8.8.8.8")).toBeNull();
  });

  it("resolves the server's own public location for the origin", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response({ ...okBody, query: "203.0.113.7" }));
    const { client } = setup(fetchImpl);
    expect((await client.origin())?.ip).toBe("203.0.113.7");
    expect(url(fetchImpl)).toMatch(/^http:\/\/ip-api\.com\/json\/\?fields=/);
  });
});
