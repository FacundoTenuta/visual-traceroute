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

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm test` | Unit tests (vitest) |
| `pnpm lint` | ESLint |

## Limits

- IPv4 targets and hostnames only for now.
- ip-api's free tier allows 45 lookups per minute; results are cached in memory, and hops beyond the limit show no location.
- Geolocation of backbone routers and anycast addresses (such as `1.1.1.1`) is approximate: it reflects where the address is registered, not always where the router is.
- At most 3 traces run at the same time.

## API

`GET /api/trace?target=<host-or-ipv4>` returns `text/event-stream`. Each `data:` frame is a JSON event: `start`, `origin`, `destination`, `hop` (sent again whenever the hop gains more detail), then `done` or `error`. Invalid targets get `400` with `{ "error": "..." }`.
