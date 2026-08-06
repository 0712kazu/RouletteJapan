import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { selectDailyQuestions as selectFrontendQuestions } from "../../js/daily-core.mjs";
import {
  japanDateKey,
  selectDailyQuestions,
  validateScore,
} from "../src/daily.js";
import worker from "../src/index.js";

const pool = JSON.parse(await readFile(new URL("../../data/daily-challenge-pool.json", import.meta.url)));

test("Workerとフロントエンドのフォールバックが同じ5問を選ぶ", () => {
  const dateKey = "2026-08-06";
  assert.deepEqual(
    selectDailyQuestions(pool.municipalities, dateKey),
    selectFrontendQuestions(pool, dateKey),
  );
});

test("Workerも日本時間で日付を切り替える", () => {
  assert.equal(japanDateKey(new Date("2026-08-05T15:00:00Z")), "2026-08-06");
});

test("ランキング値を検証する", () => {
  const valid = validateScore({
    submissionId: "12345678-abcd",
    dateKey: "2026-08-06",
    playerName: "ゲスト",
    correctCount: 4,
    totalTimeMs: 12345,
  }, "2026-08-06");
  assert.equal(valid.error, undefined);
  assert.equal(validateScore({ ...valid.value, correctCount: 6 }, "2026-08-06").error, "正解数が不正です");
  assert.equal(validateScore({ ...valid.value, dateKey: "2026-08-05" }, "2026-08-06").error, "今日のチャレンジ結果のみ登録できます");
});

test("D1が利用できない場合は503を返す", async () => {
  const response = await worker.fetch(new Request("https://example.com/api/daily"), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "ランキングサービスを利用できません" });
});

test("OPTIONSはD1なしでも応答する", async () => {
  const request = new Request("https://example.com/api/daily", {
    method: "OPTIONS",
    headers: { origin: "https://quiz.example.com" },
  });
  const response = await worker.fetch(request, { ALLOWED_ORIGIN: "https://quiz.example.com" });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://quiz.example.com");
});
