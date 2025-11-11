## Axis Trigger

Cron-backed service to compute Free-Float Adjusted Market Capitalization (FAMC) for configured crypto assets, persist price history to PostgreSQL via Prisma, and expose TradingView-compatible endpoints plus OpenAPI docs. Deployable to Cloudflare Workers and schedulable with Trigger.dev v4.

### What is FAMC?

- **Free Float** = Circulating Supply − (Foundation/Team Holdings + Locked-up Supply + Heavily‑vested Staked) + Exchange Custody Holdings
- **FAMC** = Free Float × Price (USD)

Free float removes non-tradable supply to reflect effective market size.

---

## Quick start

1) Install dependencies (pnpm)

```bash
pnpm install
```

2) Configure environment

- Copy your env template and set values:
  - `DATABASE_URL` (PostgreSQL)
  - `ASSET_CONFIG_FILE` or per‑asset envs (see Assets section)
  - Optional CoinGecko keys: `COINGECKO_PRO_API_KEY` or `COINGECKO_API_KEY`
  - Scheduling: `CRON_SCHEDULE`, `CRON_TZ`

3) Generate Prisma client and sync schema

```bash
pnpm prisma:generate
pnpm db:push
```

4) Run locally with Wrangler (OpenAPI at /docs)

```bash
pnpm dev
# http://localhost:8788/docs
```

---

## Assets configuration

You can configure assets either via a bundled JSON file or environment variables.

### Option A: JSON file (recommended for Workers)

Commit `src/assets.json` and set `ASSET_CONFIG_FILE=assets.json` so it can be bundled on Workers. Example shape:

```json
{
  "assets": [
    {
      "symbol": "BTC",
      "coingeckoId": "bitcoin",
      "circulatingSupply": 19700000,
      "foundationHoldings": 0,
      "lockedSupply": 0,
      "heavilyVestedStaked": 0,
      "exchangeCustodyHoldings": 3000000
    }
  ]
}
```

Generate a starter file from CoinGecko and upsert DB assets (writes `src/assets.json` and syncs Prisma rows):

```bash
pnpm assets:update
```

### Option B: Environment variables

Set `ASSETS` to a comma‑separated list and define per‑symbol values:

```bash
ASSETS=BTC,ETH
BTC_CIRCULATING_SUPPLY=19700000
BTC_FOUNDATION_HOLDINGS=0
BTC_LOCKED_SUPPLY=0
BTC_HEAVILY_VESTED=0
BTC_EXCHANGE_CUSTODY=3000000
BTC_COINGECKO_ID=bitcoin
ETH_CIRCULATING_SUPPLY=120000000
ETH_FOUNDATION_HOLDINGS=0
ETH_LOCKED_SUPPLY=0
ETH_HEAVILY_VESTED=0
ETH_EXCHANGE_CUSTODY=0
ETH_COINGECKO_ID=ethereum
```

Notes:
- If `ASSET_CONFIG_FILE` is set, the service uses the bundled JSON (works on Workers without fs).
- Otherwise it falls back to env‑defined assets.

---

## Data model (Prisma)

- `Price(symbol, source, price, priceTimestamp)` with unique `(symbol, priceTimestamp, source)`
- `Asset(symbol, coingeckoId, circulatingSupply, …)`

See `prisma/schema.prisma` for full details.

---

## Price ingestion

- Backfill historical prices from CoinGecko Range API:

```bash
START_DATE=2024-08-01 pnpm backfill:prices
```

- Scheduled task automatically backfills gaps and inserts latest prices (via Trigger.dev). API keys are read from env and headers set in `src/providers/coingecko/cgHeaders.ts`.

Env keys supported:
- `COINGECKO_PRO_API_KEY` or `COINGECKO_API_KEY` (alias `X_CG_API_KEY`)
- `COINGECKO_BASE_URL` (override)
- `CG_RANGE_MAX_DAYS` (chunking window, default 30)

---

## API

The server exposes OpenAPI 3.1 docs at `/docs` and `/openapi.json`.

Endpoints:
- `GET /` health
- `GET /api/famc` close‑only FAMC index series
  - Query: `from` (unix seconds, optional; default now−7d), `to` (unix seconds, optional; default now), `resolution` one of `1,5,15,60,240,D` (default `60`)
  - Response: `{ t: number[]; value: number[]; resolution: "..." }`
- `GET /api/avgindexprice` equal‑weight index normalized to a fixed base day
  - Response: `{ avg: number; baseDay: { sumOfRatios; assets: [{ symbol; basePrice }] }; symbols: string[]; count: number }`
- `GET /api/famcindexprice` FAMC index normalized to earliest DB baseline per symbol
  - Response: `{ indexPrice: number; baseDate?: string; baseIndex: number; currentIndex: number; symbols: string[]; count: number }`
- `GET /api/famcweights` — IVW (inverse-volatility) weights snapshot

Returns quarterly rebalance snapshots for the **Top-5 by market cap** with **Inverse Volatility Weighting (IVW)** (90-day daily log-return stdev). Weights are fixed between rebalances (“drift allowed”).

- **Query**
  - `from` *(unix seconds, optional)* — default: `now - 365d`
  - `to` *(unix seconds, optional)* — default: `now`
  - `resolution` ∈ `1,5,15,60,240,D` *(optional)* — default: `D` (series itself is daily; this is kept for API consistency)

- **Response**
  ```json
  {
    "resolution": "D",
    "rebalances": [
      {
        "t": 1711929600,
        "basket": ["BTC","ETH","SOL","BNB","XRP"],
        "weights": { "BTC":0.23, "ETH":0.21, "SOL":0.19, "BNB":0.18, "XRP":0.19 }
      }
    ],
    "latest": {
      "t": 1727740800,
      "basket": ["BTC","ETH","SOL","BNB","XRP"],
      "weights": { "BTC":0.24, "ETH":0.18, "SOL":0.22, "BNB":0.17, "XRP":0.19 }
    }
  }
````

* **Semantics**

  * `t`: UTC timestamp of the **rebalance**. Targets are **Jan/Apr/Jul/Oct 1st 00:00 UTC**, snapped **forward** to the first available observation on the series grid.
  * `basket`: Top-5 at `t` by **market cap = circulatingSupply × latest price≤t**; assets without supply are excluded.
  * `weights`: IVW with lookback **L=90 days**. If `σ ≤ 0` or valid observations `< 10`, that asset is excluded from IVW; if all excluded, **equal-weight fallback** on the current basket.
  * Between rebalances, weights are **kept constant** and only prices move.

* **Examples**

  ```bash
  curl "https://api.axis-protocol.xyz/api/famcweights?resolution=D"
  curl "https://api.axis-protocol.xyz/api/famcweights?from=1704067200&to=1727740800&resolution=D"
  ```

* **Client tips**

  * Use `latest.weights` to show the current allocation on the dashboard.
  * Plot `rebalances` (step chart) to visualize quarter-to-quarter weight shifts.
  * This endpoint is cached (`TTL≈60s`) via KV to reduce load.

* **Notes**

  * No schema changes required; uses existing `Price` / `Asset` tables.
  * Works with D1 or (via Hyperdrive) external Postgres; if history < 90d, expect more frequent **equal-weight fallbacks**.

```

- `POST /api/update` backfills recent prices from CoinGecko and returns a summary
  - Header: `x-update-key: <UPDATE_ACCESS_KEY>`
  - Env: `CRON_BACKFILL_DAYS` controls lookback window (default 7)
  - Response: `{ ok: true; famcSum: number; assets: number; runAt: string }`

TradingView UDF subset:
- `GET /tv/config`
- `GET /tv/time`
- `GET /tv/symbols?symbol=INDEX:FAMC`
- `GET /tv/history?symbol=INDEX:FAMC&resolution=60&from=...&to=...`

---

## Scheduling (Trigger.dev v4)

- Declarative job: `triggers/famcCron.ts`
- Schedule pulled from env via `CRON_SCHEDULE` and `CRON_TZ`
- Computes FAMC after backfilling missing prices

CLI:

```bash
pnpm trigger:dev
pnpm trigger:deploy
```

Ensure `TRIGGER_PROJECT_REF` is set. See `trigger.config.ts` and `trigger.ts`.

---

## Cloudflare Workers

`wrangler.toml` points to `src/server.ts` with `nodejs_compat` enabled. Example commands:

```bash
pnpm cf:dev    # local worker (http://localhost:8788)
pnpm cf:deploy # deploy to Cloudflare
```

Set `[vars]` in `wrangler.toml` or account‑level secrets (e.g., `DATABASE_URL`, CoinGecko keys).

---

## Environment variables

Core:
- `DATABASE_URL` PostgreSQL connection string
- `ASSET_CONFIG_FILE` path to bundled JSON (e.g., assets.json)
- `ASSETS` and per‑symbol vars (see above) if not using JSON

Scheduling:
- `CRON_SCHEDULE` default `0 * * * *`
- `CRON_TZ` optional timezone (IANA)
- `CRON_BACKFILL_DAYS` default `7`

CoinGecko:
- `COINGECKO_PRO_API_KEY` or `COINGECKO_API_KEY`/`X_CG_API_KEY`
- `COINGECKO_BASE_URL` optional
- `CG_RANGE_MAX_DAYS` default `30`

Security:
- `UPDATE_ACCESS_KEY` required to call `POST /api/update` (passed via `x-update-key` header)

---

## Development

Build and types:

```bash
pnpm build
```

Prisma tools:

```bash
pnpm prisma:studio
pnpm prisma:migrate
```

---

## Local testing

End-to-end test flow:

1) Prepare env and DB

```bash
cp .example.env .env
pnpm install
pnpm db:push
```

2) Seed assets and prices

```bash
# Option A: generate src/assets.json from CoinGecko and upsert Asset rows
pnpm assets:update

# Option B: use env-defined assets by setting ASSETS and per-symbol vars in .env

# Backfill historical prices from a date
START_DATE=2024-08-01 pnpm backfill:prices
```

3) Run the server and test endpoints

```bash
pnpm dev # serves http://localhost:8788

curl http://localhost:8788/docs
curl "http://localhost:8788/api/famc?resolution=60"
curl http://localhost:8788/api/avgindexprice
curl http://localhost:8788/api/famcindexprice

# Update task (requires UPDATE_ACCESS_KEY)
curl -X POST \
  -H "x-update-key: $UPDATE_ACCESS_KEY" \
  http://localhost:8788/api/update
```

## License

MIT

