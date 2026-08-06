# Daily challenge Worker

日替わり5問の配信とD1ランキングを提供するCloudflare Workerです。フロントエンドはこのAPIに接続できない場合、リポジトリ同梱の問題プールへ自動的に切り替わります。

## セットアップ

1. `npm install`
2. `npx wrangler d1 create roulette-japan-daily`
3. 出力されたIDを `wrangler.toml` の `database_id` に設定
4. `npm run generate:seed`
5. `npx wrangler d1 migrations apply roulette-japan-daily --local`（ローカル確認）
6. `npx wrangler d1 migrations apply roulette-japan-daily --remote`（本番反映時）
7. `ALLOWED_ORIGIN` を公開サイトのOriginへ変更

フロントエンドとWorkerが別Originの場合は、`daily.html` に次の設定を追加します。

```html
<meta name="daily-api-base" content="https://your-worker.example.workers.dev">
```

## API

- `GET /api/daily`: 日本時間の当日5問を返す
- `GET /api/rankings?date=YYYY-MM-DD`: 当日の上位20件を返す
- `POST /api/rankings`: `{ submissionId, dateKey, playerName, correctCount, totalTimeMs }` を登録

## テスト

```sh
npm test
```

スコアはクライアント申告値です。競技性を高める場合は、チャレンジ開始トークンとサーバー側採点を追加してください。
