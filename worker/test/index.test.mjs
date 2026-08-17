import assert from "node:assert/strict";
import test from "node:test";
import worker, { assignCompetitionRanks, isValidDate, validateScore } from "../.build/index.js";

const allowedEnv = (DB) => ({ DB, ALLOWED_ORIGINS: "https://0712kazu.github.io,http://localhost:8000" });

test("日付とスコア入力を検証する", () => {
  assert.equal(isValidDate("2026-08-06"), true);
  assert.equal(isValidDate("2026-02-30"), false);
  assert.equal(validateScore({
    play_date: "2026-08-06",
    player_name: " KAZU ",
    correct_count: 4,
    total_time_ms: 24310,
  }).value?.player_name, "KAZU");
  assert.match(validateScore({ play_date: "2026-08-06", player_name: "", correct_count: 4, total_time_ms: 1 }).error, /player_name/);
  assert.match(validateScore({ play_date: "2026-08-06", player_name: "K", correct_count: 6, total_time_ms: 1 }).error, /correct_count/);
  assert.match(validateScore({ play_date: "2026-08-06", player_name: "K", correct_count: 4, total_time_ms: 0 }).error, /total_time_ms/);
});

test("GET /health はD1接続状態を返す", async () => {
  const DB = {
    prepare(sql) {
      assert.match(sql, /SELECT \? AS ok/);
      return { bind(value) { assert.equal(value, 1); return { first: async () => ({ ok: 1 }) }; } };
    },
  };
  const response = await worker.fetch(new Request("https://api.example/health"), allowedEnv(DB));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", database: "ok" });
});

test("GET /health はD1障害時に503を返す", async () => {
  const DB = { prepare() { throw new Error("D1 unavailable"); } };
  const response = await worker.fetch(new Request("https://api.example/health"), allowedEnv(DB));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "error", database: "error" });
});

test("GET /ranking は指定日の上位100件をバインドして取得する", async () => {
  const rows = [
    { id: 2, play_date: "2026-08-06", player_name: "A", correct_count: 5, total_time_ms: 10000, created_at: "2026-08-06T00:00:00.000Z" },
    { id: 3, play_date: "2026-08-06", player_name: "B", correct_count: 5, total_time_ms: 10000, created_at: "2026-08-06T00:00:01.000Z" },
    { id: 4, play_date: "2026-08-06", player_name: "C", correct_count: 4, total_time_ms: 9000, created_at: "2026-08-06T00:00:02.000Z" },
  ];
  const DB = {
    prepare(sql) {
      assert.match(sql, /ORDER BY correct_count DESC, total_time_ms ASC, created_at ASC/);
      return { bind(date, limit) {
        assert.deepEqual([date, limit], ["2026-08-06", 100]);
        return { all: async () => ({ results: rows }) };
      } };
    },
  };
  const request = new Request("https://api.example/ranking?date=2026-08-06", { headers: { origin: "https://0712kazu.github.io" } });
  const response = await worker.fetch(request, allowedEnv(DB));
  const body = await response.json();
  assert.equal(response.headers.get("access-control-allow-origin"), "https://0712kazu.github.io");
  assert.equal(body.rankings[0].rank, 1);
  assert.equal(body.rankings[1].rank, 1);
  assert.equal(body.rankings[2].rank, 3);
  assert.equal(body.top.player_name, "A");
});

test("競技順位は完全同点を同順位にし、次順位を飛ばす", () => {
  const base = { play_date: "2026-08-06" };
  const rankings = assignCompetitionRanks([
    { ...base, id: 1, player_name: "A", correct_count: 5, total_time_ms: 10000, created_at: "2026-08-06T00:00:00.000Z" },
    { ...base, id: 2, player_name: "B", correct_count: 5, total_time_ms: 10000, created_at: "2026-08-06T00:00:01.000Z" },
    { ...base, id: 3, player_name: "C", correct_count: 4, total_time_ms: 8000, created_at: "2026-08-06T00:00:02.000Z" },
    { ...base, id: 4, player_name: "D", correct_count: 4, total_time_ms: 9000, created_at: "2026-08-06T00:00:03.000Z" },
    { ...base, id: 5, player_name: "E", correct_count: 4, total_time_ms: 9000, created_at: "2026-08-06T00:00:04.000Z" },
    { ...base, id: 6, player_name: "F", correct_count: 3, total_time_ms: 1000, created_at: "2026-08-06T00:00:05.000Z" },
  ]);
  assert.deepEqual(rankings.map((item) => item.rank), [1, 1, 3, 4, 4, 6]);
  assert.deepEqual(rankings.map((item) => item.player_name), ["A", "B", "C", "D", "E", "F"]);

  const secondPlaceTie = assignCompetitionRanks([
    { ...base, id: 1, player_name: "A", correct_count: 5, total_time_ms: 10000, created_at: "2026-08-06T00:00:00.000Z" },
    { ...base, id: 2, player_name: "B", correct_count: 4, total_time_ms: 9000, created_at: "2026-08-06T00:00:01.000Z" },
    { ...base, id: 3, player_name: "C", correct_count: 4, total_time_ms: 9000, created_at: "2026-08-06T00:00:02.000Z" },
    { ...base, id: 4, player_name: "D", correct_count: 3, total_time_ms: 8000, created_at: "2026-08-06T00:00:03.000Z" },
  ]);
  assert.deepEqual(secondPlaceTie.map((item) => item.rank), [1, 2, 2, 4]);
});

test("正解数を優先し、同じ正解数では合計時間を優先する", () => {
  const base = { play_date: "2026-08-06", created_at: "2026-08-06T00:00:00.000Z" };
  const rankings = assignCompetitionRanks([
    { ...base, id: 1, player_name: "A", correct_count: 5, total_time_ms: 20000 },
    { ...base, id: 2, player_name: "B", correct_count: 4, total_time_ms: 10000 },
    { ...base, id: 3, player_name: "C", correct_count: 4, total_time_ms: 12000 },
  ]);
  assert.deepEqual(rankings.map((item) => item.rank), [1, 2, 3]);
});

test("POST /score は全値をバインドして登録し順位とトップを返す", async () => {
  const prepared = [];
  const DB = {
    prepare(sql) {
      prepared.push(sql);
      if (sql.includes("INSERT INTO")) return { bind(...values) {
        assert.equal(values.length, 5);
        assert.deepEqual(values.slice(0, 4), ["2026-08-06", "KAZU", 4, 24310]);
        assert.match(values[4], /^2026-|^20\d{2}-/);
        return { run: async () => ({ meta: { last_row_id: 42 } }) };
      } };
      if (sql.includes("COUNT(*)")) return { bind(...values) {
        assert.equal(values.length, 4);
        assert.deepEqual(values, ["2026-08-06", 4, 4, 24310]);
        assert.doesNotMatch(sql, /created_at\s*</);
        assert.doesNotMatch(sql, /id\s*</);
        return { first: async () => ({ rank: 8 }) };
      } };
      return { bind(date, limit) {
        assert.deepEqual([date, limit], ["2026-08-06", 1]);
        return { first: async () => ({ id: 1, play_date: date, player_name: "TOP", correct_count: 5, total_time_ms: 10000, created_at: "2026-08-06T00:00:00.000Z" }) };
      } };
    },
  };
  const request = new Request("https://api.example/score", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:8000" },
    body: JSON.stringify({ play_date: "2026-08-06", player_name: "KAZU", correct_count: 4, total_time_ms: 24310 }),
  });
  const response = await worker.fetch(request, allowedEnv(DB));
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.score.id, 42);
  assert.equal(body.rank, 8);
  assert.equal(body.top.player_name, "TOP");
  assert.equal(prepared.length, 3);
});

test("PATCH /score/:id は同じ記録の表示名だけを変更する", async () => {
  const existing = {
    id: 42,
    play_date: "2026-08-06",
    player_name: "ゲスト",
    correct_count: 4,
    total_time_ms: 24310,
    created_at: "2026-08-06T00:00:00.000Z",
  };
  const DB = {
    prepare(sql) {
      if (sql.includes("WHERE id = ?") && sql.includes("SELECT id")) {
        return { bind(id) {
          assert.equal(id, 42);
          return { first: async () => existing };
        } };
      }
      if (sql.includes("UPDATE daily_scores")) {
        return { bind(name, id) {
          assert.deepEqual([name, id], ["まち探偵", 42]);
          return { run: async () => ({ success: true }) };
        } };
      }
      if (sql.includes("COUNT(*)")) {
        return { bind(...values) {
          assert.deepEqual(values, ["2026-08-06", 4, 4, 24310]);
          return { first: async () => ({ rank: 8 }) };
        } };
      }
      return { bind(date, limit) {
        assert.deepEqual([date, limit], ["2026-08-06", 1]);
        return { first: async () => ({ ...existing, player_name: "TOP", correct_count: 5, total_time_ms: 10000 }) };
      } };
    },
  };
  const response = await worker.fetch(new Request("https://api.example/score/42", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "http://localhost:8000" },
    body: JSON.stringify({ player_name: " まち探偵 " }),
  }), allowedEnv(DB));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.score.id, 42);
  assert.equal(body.score.player_name, "まち探偵");
  assert.equal(body.rank, 8);
});

test("許可されていないOriginにはCORSヘッダーを返さない", async () => {
  const DB = { prepare() { return { bind() { return { first: async () => ({ ok: 1 }) }; } }; } };
  const request = new Request("https://api.example/health", { headers: { origin: "https://evil.example" } });
  const response = await worker.fetch(request, allowedEnv(DB));
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
