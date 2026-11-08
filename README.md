# Visual traceroute

Trace the network path to any host and follow every hop on a 3D globe that turns into a street map as you zoom in.

Pick where the trace starts:

- **This computer**: the server runs the system `traceroute` and streams each hop as it answers (local or self-hosted installs).
- **Any of ~1,100 cities**: the trace runs on a [Globalping](https://globalping.io) probe in that city (optionally on one network there), then the route draws hop by hop. This mode only needs HTTP, so it works on Vercel. By default the app suggests the probe city nearest to the visitor.

Every hop is enriched with reverse DNS and an approximate location from [ip-api.com](https://ip-api.com). The panel shows per-hop IP, hostname, location, ASN/ISP, min/avg/max round-trip time and packet loss.

## Run it

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

Locally both modes are available. Serverless hosts cannot run traceroute, so there only remote locations are offered.

## Deploy on Vercel

1. Import the repository in Vercel (framework: Next.js) or run `vercel` from the project folder.
2. Set these environment variables (Project → Settings → Environment Variables):
   - `TRACE_LOCAL=0`: there is no traceroute binary, so only remote locations are offered.
   - `TRUST_PROXY=1`: Vercel overwrites `X-Forwarded-For`, so the per-visitor limit can trust it.
   - `GLOBALPING_TOKEN` (recommended): without it, every visitor shares Globalping's anonymous limit of 250 tests per hour for the server's IP.
3. Deploy. The visitor's nearest probe city comes from Vercel's `x-vercel-ip-latitude`/`x-vercel-ip-longitude` headers.

Before using it commercially, note that ip-api's free endpoint is for non-commercial use: set `IPAPI_KEY` (Pro) or swap in another geolocation source.

## Requirements

- Node.js 22+ and pnpm
- `traceroute` on the `PATH` for local traces (preinstalled on macOS; `apt install traceroute` on Debian/Ubuntu)
- Internet access to `ip-api.com` (geolocation), `tiles.openfreemap.org` (map tiles) and `api.globalping.io` (remote traces). No API keys needed.

## Configuration

| Variable | Effect |
| --- | --- |
| `IPAPI_KEY` | Optional ip-api Pro key. When set, lookups use the HTTPS endpoint `pro.ip-api.com` with a local budget of 1,000 per minute; without it they use the free HTTP endpoint. |
| `GLOBALPING_TOKEN` | Optional Globalping API token for remote traces; raises the hourly limit, which is otherwise shared by every visitor of a deployment. |
| `REMOTE_TRACES_PER_HOUR` | Remote traces each visitor may start per sliding hour (default `10`). Protects the Globalping quota every visitor shares. |
| `TRACE_LOCAL` | Set to `0` to turn off traces from this computer (they are offered automatically when `traceroute` is found on the `PATH`). |
| `TRUST_PROXY` | Set to `1` only behind a proxy that overwrites `X-Forwarded-For`. Enables the per-client limit; otherwise forwarding headers are ignored because any caller could forge them. |

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm test` | Unit tests (vitest) |
| `pnpm lint` | ESLint |

## Limits

- IPv4 targets and hostnames only for now.
- ip-api's free tier allows 45 lookups per minute. Without a key the app keeps itself under 40, pauses when ip-api reports the quota is used up, and caches results in memory (up to 2,000 addresses for 24 hours; unknown addresses for 5 minutes). Hops beyond the budget show no location.
- Geolocation of backbone routers and anycast addresses (such as `1.1.1.1`) is approximate: it reflects where the address is registered, not always where the router is.
- Each visitor may start 10 remote traces per hour (`REMOTE_TRACES_PER_HOUR`); local traces don't count. On a serverless host each instance keeps its own count, so the cap is approximate. Results are never cached: every trace is a fresh measurement.
- At most 3 traces run at the same time. With `TRUST_PROXY=1`, each client (by `X-Forwarded-For`) may run at most 2 of them. A trace is stopped after 150 seconds and ends with the hops found so far.
- Private hops (your own network) are shown by IP only: no reverse DNS or location, so internal hostnames are not exposed.
- Numeric shorthand such as `0x7f.1` is rejected; use a full IPv4 address.

## API

`GET /api/probes` lists the cities you can trace from, the one nearest the caller, and whether local traces are available.

`GET /api/trace?target=<host-or-ipv4>[&from=<city id>[&asn=<network>]]` returns `text/event-stream`. Each `data:` frame is a JSON event: `start`, `origin`, `destination`, `hop` (sent again whenever the hop gains more detail), then `done` or `error`. Invalid targets get `400` and busy limits get `429`, both with `{ "error": "..." }`.
