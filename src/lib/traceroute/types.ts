import type { Hop } from "./parser";

export interface GeoInfo {
  ip: string;
  lat: number;
  lon: number;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  timezone: string | null;
  isp: string | null;
  org: string | null;
  asn: string | null;
  asName: string | null;
}

export interface AddressInfo {
  ip: string;
  isPrivate: boolean;
  hostname: string | null;
  geo: GeoInfo | null;
  /** True while reverse DNS / geolocation are still in flight. */
  pending: boolean;
}

export interface EnrichedHop extends Hop {
  /** One entry per responding address, primary first. */
  addresses: AddressInfo[];
}

export type TraceEvent =
  | { type: "start"; target: string; ip: string; maxHops: number }
  | { type: "origin"; geo: GeoInfo | null }
  | { type: "destination"; geo: GeoInfo | null; hostname: string | null }
  | { type: "hop"; hop: EnrichedHop }
  | { type: "done"; elapsedMs: number; hops: number; reached: boolean }
  | { type: "error"; message: string };
