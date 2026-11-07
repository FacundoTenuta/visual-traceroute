import { describe, expect, it } from "vitest";
import { HopAccumulator, parseHeader } from "./parser";

const MACOS_SAMPLE = [
  " 1  10.1.23.1  2.755 ms  2.015 ms  1.743 ms",
  " 2  10.0.0.1  18.297 ms  7.046 ms  3.283 ms",
  " 3  * * *",
  " 4  81.46.66.5  31.377 ms",
  "    81.46.66.17  5.196 ms",
  "    81.46.66.9  4.977 ms",
  " 6  81.46.0.205  6.587 ms  5.388 ms *",
  " 8  * 213.140.39.3  6.700 ms",
  "    81.173.106.39  6.945 ms",
];

function feedAll(lines: string[]) {
  const acc = new HopAccumulator();
  const updates = lines.map((line) => acc.push(line));
  return { acc, updates };
}

describe("parseHeader", () => {
  it("reads target, resolved ip and max hops", () => {
    expect(
      parseHeader("traceroute to google.com (142.250.184.14), 30 hops max, 52 byte packets"),
    ).toEqual({ target: "google.com", ip: "142.250.184.14", maxHops: 30 });
  });

  it("returns null for non-header lines", () => {
    expect(parseHeader(" 1  10.1.23.1  2.755 ms")).toBeNull();
    expect(parseHeader("traceroute: Warning: multiple interfaces found")).toBeNull();
  });
});

describe("HopAccumulator", () => {
  it("parses a hop with three probes from one address", () => {
    const { updates } = feedAll([MACOS_SAMPLE[0]]);
    expect(updates[0]).toEqual({
      hop: 1,
      probes: [
        { ip: "10.1.23.1", rtt: 2.755 },
        { ip: "10.1.23.1", rtt: 2.015 },
        { ip: "10.1.23.1", rtt: 1.743 },
      ],
      ips: ["10.1.23.1"],
      primaryIp: "10.1.23.1",
      rtt: { min: 1.743, avg: 2.171, max: 2.755 },
      loss: 0,
      annotations: [],
    });
  });

  it("parses a fully timed-out hop", () => {
    const { updates } = feedAll([MACOS_SAMPLE[2]]);
    expect(updates[0]).toMatchObject({
      hop: 3,
      probes: [
        { ip: null, rtt: null },
        { ip: null, rtt: null },
        { ip: null, rtt: null },
      ],
      ips: [],
      primaryIp: null,
      rtt: null,
      loss: 1,
    });
  });

  it("merges continuation lines (load-balanced paths) into the same hop", () => {
    const { acc, updates } = feedAll(MACOS_SAMPLE.slice(3, 6));
    expect(updates.map((u) => u?.hop)).toEqual([4, 4, 4]);
    const hop = acc.hops().find((h) => h.hop === 4);
    expect(hop?.ips).toEqual(["81.46.66.5", "81.46.66.17", "81.46.66.9"]);
    expect(hop?.primaryIp).toBe("81.46.66.5");
    expect(hop?.probes).toHaveLength(3);
    expect(hop?.rtt).toEqual({ min: 4.977, avg: 13.85, max: 31.377 });
  });

  it("counts partial loss", () => {
    const { updates } = feedAll([MACOS_SAMPLE[6]]);
    expect(updates[0]?.loss).toBeCloseTo(1 / 3);
    expect(updates[0]?.rtt).toMatchObject({ min: 5.388, max: 6.587 });
    expect(updates[0]?.rtt?.avg).toBeCloseTo(5.9875, 2);
  });

  it("uses the first responding address when a hop starts with a timeout", () => {
    const { acc } = feedAll(MACOS_SAMPLE.slice(7, 9));
    const hop = acc.hops()[0];
    expect(hop.primaryIp).toBe("213.140.39.3");
    expect(hop.ips).toEqual(["213.140.39.3", "81.173.106.39"]);
    expect(hop.loss).toBeCloseTo(1 / 3);
  });

  it("keeps ICMP annotations such as !H", () => {
    const { updates } = feedAll([" 5  10.9.9.9  12.5 ms !H  11.1 ms !H  *"]);
    expect(updates[0]?.annotations).toEqual(["!H"]);
    expect(updates[0]?.probes).toEqual([
      { ip: "10.9.9.9", rtt: 12.5 },
      { ip: "10.9.9.9", rtt: 11.1 },
      { ip: null, rtt: null },
    ]);
  });

  it("ignores headers, blanks and continuation lines without a current hop", () => {
    const { acc, updates } = feedAll([
      "traceroute to 1.1.1.1 (1.1.1.1), 12 hops max, 40 byte packets",
      "",
      "    81.46.66.17  5.196 ms",
    ]);
    expect(updates).toEqual([null, null, null]);
    expect(acc.hops()).toEqual([]);
  });

  it("returns hops sorted by hop number", () => {
    const { acc } = feedAll(MACOS_SAMPLE);
    expect(acc.hops().map((h) => h.hop)).toEqual([1, 2, 3, 4, 6, 8]);
  });
});
