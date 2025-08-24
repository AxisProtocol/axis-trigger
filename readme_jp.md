gpt5 translate

## Axis Trigger（日本語）

本プロジェクトは、暗号資産のフリーフロート調整時価総額（FAMC）を定期的に計算し、Prisma 経由で PostgreSQL に価格ヒストリを保存し、TradingView 互換エンドポイントおよび OpenAPI ドキュメントを提供します。Cloudflare Workers へのデプロイと、Trigger.dev v4 によるスケジューリングに対応しています。

### FAMC とは

- フリーフロート = 循環供給量 −（財団/チーム保有 + ロックアップ + 強いベスティング付きステーキング）+ 取引所カストディ保有
- FAMC = フリーフロート × 価格（USD）

非流通分を除外することで、実効的な市場規模をより正確に反映します。

---

## クイックスタート

1) 依存関係のインストール（pnpm）

```bash
pnpm install
```

2) 環境変数の設定

- 例: `DATABASE_URL`（PostgreSQL）、`ASSET_CONFIG_FILE`（JSON）、またはシンボル別の環境変数
- 任意: CoinGecko キー `COINGECKO_PRO_API_KEY` または `COINGECKO_API_KEY`
- スケジュール: `CRON_SCHEDULE`, `CRON_TZ`

3) Prisma クライアント生成とスキーマ同期

```bash
pnpm prisma:generate
pnpm db:push
```

4) ローカル起動（/docs に OpenAPI）

```bash
pnpm dev
# http://localhost:8788/docs
```

---

## 資産設定

### オプションA: JSON ファイル（Workers で推奨）

`src/assets.json` をリポジトリに含め、`ASSET_CONFIG_FILE=assets.json` を設定します（Workers でもバンドル可）。例:

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

初期ファイル生成と DB 反映（`src/assets.json` を生成し、Prisma の `Asset` を upsert）:

```bash
pnpm assets:update
```

### オプションB: 環境変数

`ASSETS` にシンボルをカンマ区切りで指定し、各シンボル用の値を設定します。

```bash
ASSETS=BTC,ETH
BTC_CIRCULATING_SUPPLY=19700000
BTC_FOUNDATION_HOLDINGS=0
BTC_LOCKED_SUPPLY=0
BTC_HEAVILY_VESTED=0
BTC_EXCHANGE_CUSTODY=3000000
BTC_COINGECKO_ID=bitcoin
```

`ASSET_CONFIG_FILE` が設定されている場合は JSON が優先され、未設定の場合は環境変数が使用されます。

---

## データモデル（Prisma）

- `Price(symbol, source, price, priceTimestamp)` は `(symbol, priceTimestamp, source)` で一意
- `Asset(symbol, coingeckoId, circulatingSupply, …)`

詳細は `prisma/schema.prisma` を参照してください。

---

## 価格取得

- CoinGecko Range API からのヒストリカルバックフィル:

```bash
START_DATE=2024-08-01 pnpm backfill:prices
```

- スケジュールされたタスクが欠損分を自動で補完し、最新価格を挿入します（Trigger.dev）。API キーは環境変数から読み込みます。

サポートされるキー:
- `COINGECKO_PRO_API_KEY` または `COINGECKO_API_KEY`/`X_CG_API_KEY`
- `COINGECKO_BASE_URL`（任意）
- `CG_RANGE_MAX_DAYS`（既定 30）

---

## API 概要

OpenAPI 3.1 ドキュメント: `/docs`, `/openapi.json`

エンドポイント:
- `GET /` ヘルスチェック
- `GET /api/famc` FAMC インデックス（終値のみ時系列）
  - クエリ: `from`(unix秒, 任意, 既定 過去7日), `to`(unix秒, 任意, 既定 現在), `resolution` 〈1,5,15,60,240,D〉（既定 60）
  - レスポンス: `{ t: number[]; value: number[]; resolution: "..." }`
- `GET /api/avgindexprice` 等ウェイト平均インデックス（固定の基準日に正規化）
  - レスポンス: `{ avg; baseDay; symbols; count }`
- `GET /api/famcindexprice` 最古データを基準とした FAMC インデックス
  - レスポンス: `{ indexPrice; baseDate?; baseIndex; currentIndex; symbols; count }`
- `POST /api/update` 直近の価格を CoinGecko から取得・挿入し、FAMC 合計のサマリを返却
  - ヘッダー: `x-update-key: <UPDATE_ACCESS_KEY>`
  - 環境変数: `CRON_BACKFILL_DAYS` 既定 7
  - レスポンス: `{ ok: true; famcSum; assets; runAt }`

TradingView UDF（サブセット）:
- `GET /tv/config`
- `GET /tv/time`
- `GET /tv/symbols?symbol=INDEX:FAMC`
- `GET /tv/history?symbol=INDEX:FAMC&resolution=60&from=...&to=...`

---

## スケジューリング（Trigger.dev v4）

- 定義: `triggers/famcCron.ts`
- スケジュール: `CRON_SCHEDULE`, `CRON_TZ`
- バックフィル後に FAMC を算出

CLI:

```bash
pnpm trigger:dev
pnpm trigger:deploy
```

`TRIGGER_PROJECT_REF` を設定してください。`trigger.config.ts`, `trigger.ts` を参照。

---

## Cloudflare Workers

`wrangler.toml` は `src/server.ts` をエントリとして `nodejs_compat` を有効化しています。

```bash
pnpm cf:dev    # http://localhost:8788
pnpm cf:deploy
```

必要な変数は `[vars]` またはアカウントのシークレットに設定してください（例: `DATABASE_URL`、CoinGecko キー）。

---

## 環境変数

コア:
- `DATABASE_URL`
- `ASSET_CONFIG_FILE`（例: `assets.json`）または `ASSETS` と各シンボルの値

スケジュール:
- `CRON_SCHEDULE`（既定 `0 * * * *`）
- `CRON_TZ`（IANA タイムゾーン）
- `CRON_BACKFILL_DAYS`（既定 7）

CoinGecko:
- `COINGECKO_PRO_API_KEY` または `COINGECKO_API_KEY`/`X_CG_API_KEY`
- `COINGECKO_BASE_URL`（任意）
- `CG_RANGE_MAX_DAYS`（既定 30）

セキュリティ:
- `UPDATE_ACCESS_KEY`（`POST /api/update` 用ヘッダー `x-update-key`）

---

## ライセンス

MIT

