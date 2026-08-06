# Roulette Japan API

Cloudflare Workersと既存D1データベースを使い、デイリーチャレンジのランキングを提供します。R2は使用しません。

## 前提となるCloudflare設定

- Worker名: `roulette-japan-api`
- D1データベース名: `roulette-japan`
- D1バインディング名: `DB`
- テーブル名: `daily_scores`

このWorkerは既存の次のテーブルを利用し、マイグレーションは実行しません。

```sql
CREATE TABLE daily_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  play_date TEXT NOT NULL,
  player_name TEXT NOT NULL,
  correct_count INTEGER NOT NULL,
  total_time_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

## セットアップ

Node.js 20以上を使用してください。

```sh
npm install
npm run build
npm test
```

`wrangler.jsonc` の `database_id` を、バインド済みの既存D1データベースIDへ置き換えてください。秘密情報やAPIトークンはファイルへ記載しません。

本番Originは `ALLOWED_ORIGINS` に設定します。複数Originはカンマ区切りです。ローカル確認では、コミットせず次のように追加できます。

```sh
npx wrangler dev --var ALLOWED_ORIGINS:"https://0712kazu.github.io,http://localhost:8000,http://localhost:4173"
```

フロント側のWorker URLは `../js/api-config.mjs` の1か所で設定します。

## API

### `GET /health`

D1へバインドクエリを実行し、正常時は次を返します。

```json
{ "status": "ok", "database": "ok" }
```

### `GET /ranking?date=YYYY-MM-DD`

指定日の上位100件を、正解数降順、合計時間昇順で返します。正解数と合計時間が同じ記録は同順位とし、次の順位を人数分飛ばす競技順位方式です。完全同点者の表示順だけは `created_at ASC, id ASC` で安定させます。

### `POST /score`

```json
{
  "play_date": "2026-08-06",
  "player_name": "KAZU",
  "correct_count": 4,
  "total_time_ms": 24310
}
```

登録結果に加え、登録時点の全国順位と暫定トップを返します。`created_at` はWorkerがUTCのISO 8601形式で生成します。合計時間の上限は30分です。

## ローカル確認

```sh
npm run dev
curl http://localhost:8787/health
curl "http://localhost:8787/ranking?date=2026-08-06"
```

本番デプロイはこの手順には含めません。Workers Free・D1 Freeの範囲で動作し、R2への接続はありません。
