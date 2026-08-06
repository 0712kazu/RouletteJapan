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

function conservativeXLength(value) {
  const urls = value.match(/https?:\/\/\S+/gu) ?? [];
  const text = value.replace(/https?:\/\/\S+/gu, "");
  return Array.from(text).reduce((length, character) => (
    length + (character.codePointAt(0) <= 0x7f ? 1 : 2)
  ), 0) + (urls.length * 23);
}

test("全国の市・東京23区・町・村を重複なく収録する", () => {
  assert.equal(pool.municipalities.length, 1747);
  assert.equal(new Set(pool.municipalities.map((item) => item.code)).size, 1747);
  const counts = pool.municipalities.reduce((result, item) => {
    result[item.municipalityType] += 1;
    return result;
  }, { city: 0, tokyoWard: 0, town: 0, village: 0 });
  assert.deepEqual(counts, { city: 792, tokyoWard: 23, town: 743, village: 189 });
});

test("政令指定都市の行政区・郡・都道府県を出題対象に含めない", () => {
  assert.equal(pool.municipalities.some((item) => item.name.endsWith("区") && item.municipalityType !== "tokyoWard"), false);
  assert.equal(pool.municipalities.some((item) => item.name.endsWith("郡")), false);
  assert.equal(pool.municipalities.some((item) => /[都道府県]$/u.test(item.name)), false);
  assert.ok(pool.municipalities.some((item) => item.code === "14100" && item.name === "横浜市"));
});

test("公式人口のない承認済み7町村だけを難しいに分類する", () => {
  const missing = pool.municipalities.filter((item) => item.population === null);
  assert.equal(missing.length, 7);
  assert.ok(missing.every((item) => item.populationBand === "hard"));
  assert.ok(missing.every((item) => item.populationStatus === "official-data-unavailable"));
  assert.equal(pool.municipalities.filter((item) => item.populationBand === "easy").length, 130);
  assert.equal(pool.municipalities.filter((item) => item.populationBand === "normal").length, 395);
  assert.equal(pool.municipalities.filter((item) => item.populationBand === "hard").length, 1222);
});

test("日本時間0時で日付キーを切り替える", () => {
  assert.equal(japanDateKey(new Date("2026-08-05T15:00:00.000Z")), "2026-08-06");
  assert.equal(japanDateKey(new Date("2026-08-05T14:59:59.999Z")), "2026-08-05");
});

test("同じ日付は同じ5問で、簡単1・普通1・難しい3になり重複しない", () => {
  const first = selectDailyQuestions(pool, "2026-08-06");
  const second = selectDailyQuestions(pool, "2026-08-06");
  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
  assert.equal(new Set(first.map((item) => item.code)).size, 5);
  assert.deepEqual(first.map((item) => item.populationBand), ["easy", "normal", "hard", "hard", "hard"]);
  assert.deepEqual(first.map((item) => item.difficulty), ["easy", "normal", "hard", "hard", "hard"]);
});

test("各人口区分は全候補が一巡するまで再出題しない", () => {
  for (const { id, questionsPerDay } of pool.populationBands) {
    const candidateCount = pool.municipalities.filter((item) => item.populationBand === id).length;
    const selected = [];
    for (let day = 0; selected.length < candidateCount; day += 1) {
      const date = new Date(Date.UTC(1970, 0, 1 + day)).toISOString().slice(0, 10);
      selected.push(...selectDailyQuestions(pool, date)
        .filter((item) => item.populationBand === id)
        .map((item) => item.code));
      assert.equal(questionsPerDay, id === "hard" ? 3 : 1);
    }
    assert.equal(new Set(selected.slice(0, candidateCount)).size, candidateCount, `${id} は一巡するまで重複しない`);
  }
});

const oizumi = {
  name: "大泉町",
  prefecture: "群馬県",
  district: "邑楽郡",
};

test("自治体名、都道府県名、郡名、都道府県名＋郡名を正しく受け付ける", () => {
  assert.equal(isCorrectAnswer("大泉町", oizumi), true);
  assert.equal(isCorrectAnswer("群馬県大泉町", oizumi), true);
  assert.equal(isCorrectAnswer("邑楽郡大泉町", oizumi), true);
  assert.equal(isCorrectAnswer("群馬県邑楽郡大泉町", oizumi), true);
});

test("東京23区は区名または正しい都名付きで受け付ける", () => {
  const shinjuku = { name: "新宿区", prefecture: "東京都", district: null };
  assert.equal(isCorrectAnswer("新宿区", shinjuku), true);
  assert.equal(isCorrectAnswer("東京都新宿区", shinjuku), true);
  assert.equal(isCorrectAnswer("新宿", shinjuku), false);
});

test("NFKC正規化と内部を含む全角・半角空白除去を維持する", () => {
  assert.equal(normalizeMunicipalityName("  横 浜　市\t"), "横浜市");
  assert.equal(isCorrectAnswer("ﾆｾｺ 町", { name: "ニセコ町", prefecture: "北海道", district: "虻田郡" }), true);
});

test("誤った都道府県名・郡名、ひらがなのみ、空文字は不正解", () => {
  assert.equal(isCorrectAnswer("栃木県大泉町", oizumi), false);
  assert.equal(isCorrectAnswer("吾妻郡大泉町", oizumi), false);
  assert.equal(isCorrectAnswer("おおいずみまち", oizumi), false);
  assert.equal(isCorrectAnswer("　 ", oizumi), false);
});

test("ランキング利用可能時のX投稿文は正式タイトルとURLを使う", () => {
  const text = buildShareText({
    correctCount: 4,
    elapsedMs: 12340,
    rank: 8,
    top: { correct_count: 5, total_time_ms: 9870 },
    rankingAvailable: true,
  });
  assert.equal(text, `🎯 きょうの市区町村クイズ

5問中 4問正解
合計 12.34秒
全国 8位

本日の暫定トップ
5問正解／9.87秒

あなたも挑戦
https://0712kazu.github.io/RouletteJapan/daily.html

制作：@sukyuppa
#市区町村ルーレット #地理クイズ`);
  assert.equal((text.match(/🎯/gu) ?? []).length, 1);
  assert.match(text, /制作：@sukyuppa/);
  assert.ok(conservativeXLength(text) <= 280);
});

test("ランキング停止時も保存済みトップの有無にかかわらず投稿文を生成する", () => {
  const withTop = buildShareText({
    correctCount: 3,
    elapsedMs: 45670,
    top: { correct_count: 5, total_time_ms: 9870 },
    rankingAvailable: false,
  });
  assert.match(withTop, /ランキングは現在利用できませんが、クイズは通常どおり遊べます。/);
  assert.match(withTop, /停止前の暫定トップ\n5問正解／9\.87秒/);
  assert.equal((withTop.match(/🎯/gu) ?? []).length, 1);
  assert.ok(conservativeXLength(withTop) <= 280);

  const withoutTop = buildShareText({ correctCount: 0, elapsedMs: 1000, rankingAvailable: false });
  assert.doesNotMatch(withoutTop, /暫定トップ/);
  assert.match(withoutTop, /RouletteJapan\/daily\.html/);
  assert.match(withoutTop, /@sukyuppa/);
  assert.ok(conservativeXLength(withoutTop) <= 280);
});
