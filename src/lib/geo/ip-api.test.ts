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

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createIpApiClient", () => {
  it("maps ip-api fields into GeoInfo", async () => {
    const fetchImpl = vi.fn(async () => response(okBody));
    const client = createIpApiClient(fetchImpl);
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
    expect(String(vi.mocked(fetchImpl).mock.calls[0][0])).toMatch(/^http:\/\/ip-api\.com\/json\/8\.8\.8\.8\?fields=/);
  });

  it("caches lookups per address", async () => {
    const fetchImpl = vi.fn(async () => response(okBody));
    const client = createIpApiClient(fetchImpl);
    await client.geolocate("8.8.8.8");
    await client.geolocate("8.8.8.8");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns null when ip-api reports a failure or rate limit", async () => {
    const failing = createIpApiClient(vi.fn(async () => response({ status: "fail", message: "reserved range" })));
    expect(await failing.geolocate("10.0.0.1")).toBeNull();
    const limited = createIpApiClient(vi.fn(async () => response({}, 429)));
    expect(await limited.geolocate("8.8.8.8")).toBeNull();
  });

  it("does not cache failures, so a later lookup can succeed", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({}, 429)).mockResolvedValueOnce(response(okBody));
    const client = createIpApiClient(fetchImpl);
    expect(await client.geolocate("8.8.8.8")).toBeNull();
    expect(await client.geolocate("8.8.8.8")).not.toBeNull();
  });

  it("resolves the server's own public location for the origin", async () => {
    const fetchImpl = vi.fn(async () => response({ ...okBody, query: "203.0.113.7" }));
    const client = createIpApiClient(fetchImpl);
    expect((await client.origin())?.ip).toBe("203.0.113.7");
    expect(String(vi.mocked(fetchImpl).mock.calls[0][0])).toMatch(/^http:\/\/ip-api\.com\/json\/\?fields=/);
  });
});
