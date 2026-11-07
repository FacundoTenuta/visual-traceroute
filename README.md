# Visual traceroute

Trace the network path to any host and follow every hop on a 3D globe that turns into a street map as you zoom in.

The server runs the system `traceroute` and streams each hop to the browser as it answers. Every hop is enriched with reverse DNS and an approximate location from [ip-api.com](https://ip-api.com). The panel shows per-hop IP, hostname, location, ASN/ISP, min/avg/max round-trip time and packet loss.

## Run it

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

Traces start from the machine running the app, so run it locally. Serverless hosts usually cannot send the probes traceroute needs.

## Requirements

- Node.js 22+ and pnpm
- `traceroute` on the `PATH` (preinstalled on macOS; `apt install traceroute` on Debian/Ubuntu)
- Internet access to `ip-api.com` (geolocation) and `tiles.openfreemap.org` (map tiles). No API keys needed.

## Configuration

| Variable | Effect |
| --- | --- |
| `IPAPI_KEY` | Optional ip-api Pro key. When set, lookups use the HTTPS endpoint `pro.ip-api.com`; without it they use the free HTTP endpoint. |

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm test` | Unit tests (vitest) |
| `pnpm lint` | ESLint |

## Limits

- IPv4 targets and hostnames only for now.
- ip-api's free tier allows 45 lookups per minute. The app keeps itself under 40, pauses when ip-api reports the quota is used up, and caches results in memory (up to 2,000 addresses for 24 hours; unknown addresses for 5 minutes). Hops beyond the budget show no location.
- Geolocation of backbone routers and anycast addresses (such as `1.1.1.1`) is approximate: it reflects where the address is registered, not always where the router is.
- At most 3 traces run at the same time, and at most 2 per client (identified by `X-Forwarded-For` when a proxy sets it). A trace is stopped after 150 seconds.
- Private hops (your own network) are shown by IP only: no reverse DNS or location, so internal hostnames are not exposed.
- Numeric shorthand such as `0x7f.1` is rejected; use a full IPv4 address.

## API

`GET /api/trace?target=<host-or-ipv4>` returns `text/event-stream`. Each `data:` frame is a JSON event: `start`, `origin`, `destination`, `hop` (sent again whenever the hop gains more detail), then `done` or `error`. Invalid targets get `400` and busy limits get `429`, both with `{ "error": "..." }`.
