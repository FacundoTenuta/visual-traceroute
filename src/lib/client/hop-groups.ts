import type { EnrichedHop } from "@/lib/traceroute/types";

export type HopItem =
  | { kind: "hop"; hop: EnrichedHop }
  /** Consecutive hops whose routers did not answer, shown as one compact row. */
  | { kind: "silent"; from: number; to: number; trailing: boolean };

const isSilent = (hop: EnrichedHop) => hop.addresses.length === 0 && hop.primaryIp === null;

/**
 * Collapses runs of silent hops so the list stays short and numbering stays
 * continuous. A run at the very end is `trailing` once the trace has ended:
 * the destination (or the routers just before it) filters the probes.
 */
export function groupHops(hops: EnrichedHop[], finished: boolean): HopItem[] {
  const items: HopItem[] = [];
  for (const hop of hops) {
    const last = items.at(-1);
    if (!isSilent(hop)) {
      items.push({ kind: "hop", hop });
    } else if (last?.kind === "silent" && last.to + 1 === hop.hop) {
      last.to = hop.hop;
    } else {
      items.push({ kind: "silent", from: hop.hop, to: hop.hop, trailing: false });
    }
  }
  const tail = items.at(-1);
  if (finished && tail?.kind === "silent") tail.trailing = true;
  return items;
}
