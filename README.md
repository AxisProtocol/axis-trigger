## Axis Trigger - FAMC Cron

Computes Free-Float Adjusted Market Capitalization (FAMC) for assets on a schedule.

### FAMC Concept

- **Free Float** = Circulating Supply - (Foundation/Team Holdings + Locked-up Supply + Heavily-vested Staked Assets, etc.) + Exchange Custody Holdings
- **FAMC** = Free Float × Price

This removes non-tradable supply to better reflect effective market size.

### Setup

1. Install deps (pnpm):

```bash
pnpm install
```

2. Configure `.env` (copy from `.env.example`). Provide assets via `ASSET_CONFIG_FILE` (JSON) or per-asset env vars.

#### Example JSON (assets.config.json)

```json
{
  "assets": [
    {
      "symbol": "BTC",
      "price": 65000,
      "circulatingSupply": 19700000,
      "foundationHoldings": 0,
      "lockedSupply": 0,
      "heavilyVestedStaked": 0,
      "exchangeCustodyHoldings": 3000000
    }
  ]
}
```

### Commands

- `pnpm build` – compile TypeScript
- `pnpm once` – run computation once and exit
- `pnpm cron` – start cron scheduler

Outputs are written to `output/latest.json` and timestamped files in `output/`.

