import { describe, expect, it } from "vitest";
import { isIPv4, isPrivateIPv4 } from "./ip";

describe("isIPv4", () => {
  it.each(["1.1.1.1", "192.168.0.1", "255.255.255.255", "0.0.0.0"])("accepts %s", (ip) => {
    expect(isIPv4(ip)).toBe(true);
  });

  it.each(["256.1.1.1", "1.1.1", "1.1.1.1.1", "01.1.1.1", "a.b.c.d", "", "1.1.1.1 "])(
    "rejects %j",
    (ip) => {
      expect(isIPv4(ip)).toBe(false);
    },
  );
});

describe("isPrivateIPv4", () => {
  it.each([
    "10.1.23.1",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "127.0.0.1",
    "169.254.10.10",
    "100.64.0.1",
    "100.127.255.255",
    "0.1.2.3",
    "224.0.0.1",
  ])("treats %s as non-routable", (ip) => {
    expect(isPrivateIPv4(ip)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "172.32.0.1", "100.128.0.1", "81.46.66.5"])(
    "treats %s as public",
    (ip) => {
      expect(isPrivateIPv4(ip)).toBe(false);
    },
  );
});
