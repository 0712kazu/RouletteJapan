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

test("同じ日付は全員同じ5問になり、簡単1・普通1・難しい3で重複しない", () => {
  const first = selectDailyQuestions(pool, "2026-08-06");
  const second = selectDailyQuestions(pool, "2026-08-06");
  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
  assert.equal(new Set(first.map((item) => item.code)).size, 5);
  assert.deepEqual(first.map((item) => item.populationBand), pool.populationBands.map((band) => band.id));
  assert.deepEqual(first.map((item) => item.difficulty), ["easy", "normal", "hard", "hard", "hard"]);
});

test("同じ自治体コードが複数区分に含まれても重複出題しない", () => {
  const duplicatePool = structuredClone(pool);
  duplicatePool.municipalities = duplicatePool.populationBands.flatMap(({ id }, index) => [
    { code: "00000", name: "重複市", prefCode: "00", prefecture: "試験県", populationBand: id },
    { code: `0000${index + 1}`, name: `候補${index + 1}市`, prefCode: "00", prefecture: "試験県", populationBand: id },
  ]);

  for (let day = 1; day <= 31; day += 1) {
    const questions = selectDailyQuestions(duplicatePool, `2026-08-${String(day).padStart(2, "0")}`);
    assert.equal(new Set(questions.map((item) => item.code)).size, 5);
  }
});

test("各人口区分の全候補が一巡するまで同じ市区町村を再出題しない", () => {
  pool.populationBands.forEach(({ id }, bandIndex) => {
    const candidateCount = pool.municipalities.filter((item) => item.populationBand === id).length;
    const selected = [];
    for (let day = 0; day < candidateCount; day += 1) {
      const date = new Date(Date.UTC(1970, 0, 1 + day)).toISOString().slice(0, 10);
      selected.push(selectDailyQuestions(pool, date)[bandIndex].code);
    }
    assert.equal(new Set(selected).size, candidateCount, `${id} は一巡するまで重複しない`);
  });
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

test("X投稿文は取得できた順位と暫定トップを追加できる", () => {
  const text = buildShareText({
    dateKey: "2026-08-06",
    correctCount: 4,
    elapsedMs: 12340,
    rank: 8,
    top: { correct_count: 5, total_time_ms: 9870 },
  });
  assert.match(text, /全国順位：8位/);
  assert.match(text, /本日の暫定トップ：5\/5・9\.87秒/);
});
