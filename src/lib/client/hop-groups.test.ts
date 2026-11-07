import { describe, expect, it } from "vitest";
import type { EnrichedHop } from "@/lib/traceroute/types";
import { groupHops } from "./hop-groups";

const answered = (n: number): EnrichedHop => ({
  hop: n,
  probes: [{ ip: `10.0.0.${n}`, rtt: 5 }],
  ips: [`10.0.0.${n}`],
  primaryIp: `10.0.0.${n}`,
  rtt: { min: 5, avg: 5, max: 5 },
  loss: 0,
  annotations: [],
  addresses: [],
});
const silent = (n: number): EnrichedHop => ({ ...answered(n), probes: [], ips: [], primaryIp: null, rtt: null, loss: 1 });

describe("groupHops", () => {
  it("keeps answering hops as they are", () => {
    expect(groupHops([answered(1), answered(2)], false)).toEqual([
      { kind: "hop", hop: answered(1) },
      { kind: "hop", hop: answered(2) },
    ]);
  });

  it("collapses consecutive silent hops into one range", () => {
    const items = groupHops([answered(1), silent(2), silent(3), silent(4), answered(5), silent(6), answered(7)], false);
    expect(items.map((i) => (i.kind === "hop" ? i.hop.hop : `${i.from}-${i.to}${i.trailing ? "!" : ""}`))).toEqual([
      1,
      "2-4",
      5,
      "6-6",
      7,
    ]);
  });

  it("marks the final silent run as trailing once the trace has ended", () => {
    const hops = [answered(1), silent(2), silent(3)];
    expect(groupHops(hops, true).at(-1)).toEqual({ kind: "silent", from: 2, to: 3, trailing: true });
    // While tracing, later hops may still answer, so it is not trailing yet.
    expect(groupHops(hops, false).at(-1)).toEqual({ kind: "silent", from: 2, to: 3, trailing: false });
  });

  it("does not treat a gap in hop numbers as silence", () => {
    expect(groupHops([answered(1), answered(3)], true)).toHaveLength(2);
  });
});
