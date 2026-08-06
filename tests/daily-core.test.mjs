import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  buildShareText,
  isCorrectAnswer,
  japanDateKey,
  normalizeMunicipalityName,
  selectDailyQuestions,
} from "../js/daily-core.mjs";

const pool = JSON.parse(await readFile(new URL("../data/daily-challenge-pool.json", import.meta.url)));

test("日本時間の日付キーを作る", () => {
  assert.equal(japanDateKey(new Date("2026-08-05T15:00:00.000Z")), "2026-08-06");
  assert.equal(japanDateKey(new Date("2026-08-05T14:59:59.999Z")), "2026-08-05");
});

test("同じ日付は全員同じ5問になり、各人口区分から1問選ばれる", () => {
  const first = selectDailyQuestions(pool, "2026-08-06");
  const second = selectDailyQuestions(pool, "2026-08-06");
  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
  assert.equal(new Set(first.map((item) => item.code)).size, 5);
  assert.deepEqual(first.map((item) => item.populationBand), pool.populationBands.map((band) => band.id));
});

test("回答はUnicode正規化と空白除去を行う", () => {
  assert.equal(normalizeMunicipalityName("  横 浜 市　"), "横浜市");
  assert.equal(isCorrectAnswer("さいたま市", "さいたま市"), true);
  assert.equal(isCorrectAnswer("さいたま", "さいたま市"), false);
});

test("X投稿文に日付、点数、時間を含める", () => {
  const text = buildShareText({ dateKey: "2026-08-06", correctCount: 4, elapsedMs: 12340, url: "https://example.com/daily.html" });
  assert.match(text, /5問中4問正解/);
  assert.match(text, /12\.34秒/);
  assert.match(text, /https:\/\/example\.com/);
});
