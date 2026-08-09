import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const dailyHtml = await readFile(new URL("../daily.html", import.meta.url), "utf8");
const dailyCss = await readFile(new URL("../css/daily.css", import.meta.url), "utf8");
const dailyScript = await readFile(new URL("../js/daily-challenge.js", import.meta.url), "utf8");
const rouletteHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const rouletteScript = await readFile(new URL("../js/roulette.js", import.meta.url), "utf8");

test("トップ画面に正式タイトルと必要最低限のルールを常時表示する", () => {
  assert.match(dailyHtml, /<h1><span class="title-accent">きょうの<\/span><span>市区町村クイズ<\/span><\/h1>/);
  assert.match(dailyHtml, /<h2>ルール<\/h2>/);
  assert.match(dailyHtml, /毎日0時に全国共通の5問が更新されます/);
  assert.match(dailyHtml, /地図で示された市区町村名を入力してください/);
  assert.match(dailyHtml, /都道府県名・郡名は入力不要です/);
  assert.match(dailyHtml, /正解数が多い順、同じ場合は合計回答時間が短い順で順位が決まります/);
  assert.match(dailyHtml, /正解数と合計時間が同じ場合は同順位です/);
  assert.doesNotMatch(dailyHtml, /<details|日本地理練習帳/);
});

test("デイリー画面はM PLUS Rounded 1cを読み込み、入力必須と時間制限なしを維持する", () => {
  assert.match(dailyHtml, /family=M\+PLUS\+Rounded\+1c/);
  assert.match(dailyCss, /font-family: "M PLUS Rounded 1c"/);
  assert.match(dailyHtml, /id="municipality-answer"[^>]*required/);
  assert.doesNotMatch(dailyHtml, /id="countdown"|回答制限時間/);
});

test("スマホの入力中と回答後を分離し、回答後は通常スクロールへ戻す", () => {
  assert.match(dailyScript, /setQuizPhase\("answering"\)/);
  assert.match(dailyScript, /elements\.answerInput\.blur\(\);\s+setQuizPhase\("feedback"\)/);
  assert.match(dailyCss, /body\.is-daily-answering\.is-keyboard-visible \.daily-quiz/);
  assert.match(dailyCss, /body\.is-answer-feedback[\s\S]*overflow: visible/);
  assert.doesNotMatch(dailyCss, /body\.is-daily-playing\s*\{\s*overflow: hidden/);
});

test("惜しい表示と地図の初期表示復元をデイリー画面だけに追加する", () => {
  assert.match(dailyHtml, /id="map-reset-button"[^>]*disabled>元に戻す<\/button>/);
  assert.match(dailyHtml, /class="map-control-button daily-map-reset"/);
  assert.doesNotMatch(dailyHtml, /class="map-reset"/);
  assert.match(dailyScript, /isCloseAnswer\(input, question\)/);
  assert.match(dailyScript, /feedbackTitle\.textContent = correct \? "正解！" : close \? "惜しい！" : "不正解"/);
  assert.match(dailyScript, /initialMapView: null/);
  assert.match(dailyScript, /map\.setView\(state\.initialMapView\.center, state\.initialMapView\.zoom/);
  assert.match(dailyCss, /is-keyboard-visible \.map-controls/);
});

test("通常ルーレットの基本要素と全国自治体読込を維持する", () => {
  assert.match(rouletteHtml, /id="start-button"/);
  assert.match(rouletteHtml, /id="prefecture-select"/);
  assert.match(rouletteHtml, /id="map"/);
  assert.match(rouletteScript, /data\/municipalities\/index\.json/);
  assert.match(rouletteScript, /function startRound\(\)/);
});
