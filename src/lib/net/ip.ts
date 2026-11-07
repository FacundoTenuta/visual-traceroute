const OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_RE = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);

export function isIPv4(value: string): boolean {
  return IPV4_RE.test(value);
}

export function looksLikeIPv6(value: string): boolean {
  return value.includes(":") && /^[0-9a-f:.]+$/i.test(value);
}

/** Non-routable ranges that have no meaningful geolocation. */
const NON_ROUTABLE: Array<[number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8 "this network"
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10 carrier-grade NAT
  [0x7f000000, 8], // 127.0.0.0/8 loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 link-local
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xe0000000, 3], // 224.0.0.0/3 multicast + reserved
];

function toInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);
}

export function isPrivateIPv4(ip: string): boolean {
  if (!isIPv4(ip)) return false;
  const value = toInt(ip);
  return NON_ROUTABLE.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === base;
  });
}
