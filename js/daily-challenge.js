import {
  buildShareText,
  formatElapsed,
  isCorrectAnswer,
  japanDateKey,
  selectDailyQuestions,
} from "./daily-core.mjs";

const API_BASE = document.querySelector('meta[name="daily-api-base"]')?.content?.replace(/\/$/, "") ?? "";
const QUESTION_COUNT = 5;
const QUESTION_INTRO_MS = 2000;
const JAPAN_BOUNDS = L.latLngBounds([20.2, 122.8], [46.2, 154.1]);

const elements = {
  answerButton: document.querySelector("#answer-button"),
  answerForm: document.querySelector("#answer-form"),
  answerInput: document.querySelector("#municipality-answer"),
  copyButton: document.querySelector("#copy-button"),
  copyStatus: document.querySelector("#copy-status"),
  dailyDate: document.querySelector("#daily-date"),
  feedback: document.querySelector("#feedback"),
  feedbackAnswer: document.querySelector("#feedback-answer"),
  feedbackTitle: document.querySelector("#feedback-title"),
  introView: document.querySelector("#intro-view"),
  loadStatus: document.querySelector("#load-status"),
  mapLoading: document.querySelector("#map-loading"),
  nextButton: document.querySelector("#next-button"),
  playerName: document.querySelector("#player-name"),
  populationBadge: document.querySelector("#population-badge"),
  questionIntroText: document.querySelector("#question-intro-text"),
  questionIntroView: document.querySelector("#question-intro-view"),
  questionProgress: document.querySelector("#question-progress"),
  questionSteps: document.querySelector("#question-steps"),
  quizView: document.querySelector("#quiz-view"),
  rankingForm: document.querySelector("#ranking-form"),
  rankingList: document.querySelector("#ranking-list"),
  rankingStatus: document.querySelector("#ranking-status"),
  resultList: document.querySelector("#result-list"),
  resultScore: document.querySelector("#result-score"),
  resultTime: document.querySelector("#result-time"),
  resultView: document.querySelector("#result-view"),
  shareText: document.querySelector("#share-text"),
  startButton: document.querySelector("#daily-start-button"),
  xShareLink: document.querySelector("#x-share-link"),
  zoomOutButton: document.querySelector("#zoom-out-button"),
};

const map = L.map("daily-map", {
  minZoom: 3,
  maxZoom: 11,
  zoomSnap: 0.5,
  zoomDelta: 0.5,
  zoomControl: false,
  dragging: false,
  boxZoom: false,
  scrollWheelZoom: false,
  doubleClickZoom: false,
  touchZoom: false,
  keyboard: false,
  attributionControl: true,
}).fitBounds(JAPAN_BOUNDS);

function updateZoomOutButton() {
  elements.zoomOutButton.disabled = map.getZoom() <= map.getMinZoom();
}

map.on("zoomend", updateZoomOutButton);

L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png", {
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
  maxZoom: 11,
  opacity: 0.84,
}).addTo(map);

const state = {
  dateKey: japanDateKey(),
  questions: [],
  bands: new Map(),
  currentIndex: 0,
  results: [],
  questionStartedAt: 0,
  layer: null,
  source: "fallback",
  submissionId: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
};

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

async function fetchJson(url, options = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

function formatDateLabel(dateKey) {
  const [year, month, day] = dateKey.split("-");
  return `${year}年${Number(month)}月${Number(day)}日（日本時間）`;
}

async function loadChallenge() {
  try {
    const payload = await fetchJson(apiUrl("/api/daily"));
    if (!payload.dateKey || payload.questions?.length !== QUESTION_COUNT) throw new Error("問題形式が不正です");
    state.dateKey = payload.dateKey;
    state.questions = payload.questions;
    state.bands = new Map(payload.populationBands.map((band) => [band.id, band.label]));
    state.source = "api";
    elements.loadStatus.textContent = "今日の共通問題を読み込みました。";
  } catch (error) {
    console.info("デイリーAPIを利用できないため同梱問題を使います。", error.message);
    const pool = await fetchJson("data/daily-challenge-pool.json", {}, 6000);
    state.dateKey = japanDateKey();
    state.questions = selectDailyQuestions(pool, state.dateKey);
    state.bands = new Map(pool.populationBands.map((band) => [band.id, band.label]));
    elements.loadStatus.textContent = "オフライン用の共通問題でプレイできます。ランキングは接続時のみ利用できます。";
  }

  elements.dailyDate.textContent = formatDateLabel(state.dateKey);
  elements.startButton.disabled = false;
}

async function loadFeature(question) {
  const geojson = await fetchJson(`data/municipalities/${question.prefCode}.geojson`, {}, 8000);
  const feature = geojson.features.find((item) => item.properties.code === question.code);
  if (!feature) throw new Error("市区町村の境界が見つかりませんでした");
  return feature;
}

function showFeature(feature) {
  if (state.layer) map.removeLayer(state.layer);
  state.layer = L.geoJSON(feature, {
    interactive: false,
    style: {
      color: "#8f2618",
      fillColor: "#d94b35",
      fillOpacity: 0.88,
      lineJoin: "round",
      opacity: 1,
      weight: 1.4,
    },
  }).addTo(map);
  const bounds = state.layer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.18), { animate: false, maxZoom: 9 });
  updateZoomOutButton();
}

async function showQuestion() {
  const question = state.questions[state.currentIndex];
  elements.questionProgress.textContent = `第${state.currentIndex + 1}問`;
  elements.populationBadge.textContent = `凡例｜人口区分：${state.bands.get(question.populationBand)}`;
  elements.questionSteps.setAttribute("aria-label", `全${QUESTION_COUNT}問中${state.currentIndex + 1}問目`);
  [...elements.questionSteps.children].forEach((step, index) => {
    step.classList.toggle("is-current", index === state.currentIndex);
    step.classList.toggle("is-complete", index < state.currentIndex);
  });
  elements.answerInput.value = "";
  elements.answerInput.disabled = true;
  elements.answerButton.disabled = true;
  elements.feedback.hidden = true;
  elements.mapLoading.hidden = false;
  elements.mapLoading.textContent = "地図を準備しています…";

  try {
    showFeature(await loadFeature(question));
    elements.mapLoading.hidden = true;
    elements.answerInput.disabled = false;
    elements.answerButton.disabled = false;
    state.questionStartedAt = performance.now();
    elements.answerInput.focus();
  } catch (error) {
    elements.mapLoading.textContent = `${error.message} 再読み込みしてください。`;
  }
}

function showQuestionIntro() {
  elements.quizView.hidden = true;
  elements.questionIntroText.textContent = `第${state.currentIndex + 1}問！`;
  elements.questionIntroView.hidden = false;

  window.setTimeout(() => {
    elements.questionIntroView.hidden = true;
    elements.quizView.hidden = false;
    window.requestAnimationFrame(() => {
      map.invalidateSize();
      showQuestion();
    });
  }, QUESTION_INTRO_MS);
}

function startChallenge() {
  elements.introView.hidden = true;
  showQuestionIntro();
}

function submitAnswer(event) {
  event.preventDefault();
  if (elements.answerInput.disabled) return;
  const question = state.questions[state.currentIndex];
  const elapsedMs = Math.max(0, Math.round(performance.now() - state.questionStartedAt));
  const input = elements.answerInput.value;
  const correct = isCorrectAnswer(input, question.name);
  state.results.push({ ...question, input, correct, elapsedMs });

  elements.answerInput.disabled = true;
  elements.answerButton.disabled = true;
  elements.feedback.hidden = false;
  elements.feedback.className = `feedback ${correct ? "is-correct" : "is-wrong"}`;
  elements.feedbackTitle.textContent = correct ? "正解！" : "惜しい！";
  elements.feedbackAnswer.textContent = `答え：${question.prefecture} ${question.name}（${formatElapsed(elapsedMs)}）`;
  elements.nextButton.textContent = state.currentIndex === QUESTION_COUNT - 1 ? "結果を見る" : "次の問題へ";
  elements.nextButton.focus();
}

function goNext() {
  state.currentIndex += 1;
  if (state.currentIndex < QUESTION_COUNT) {
    showQuestionIntro();
  } else {
    showResults();
  }
}

function scoreSummary() {
  return {
    correctCount: state.results.filter((result) => result.correct).length,
    totalTimeMs: state.results.reduce((sum, result) => sum + result.elapsedMs, 0),
  };
}

function renderResultList() {
  elements.resultList.replaceChildren(...state.results.map((result, index) => {
    const item = document.createElement("li");
    item.className = result.correct ? "correct" : "wrong";
    item.textContent = `${index + 1}. ${result.correct ? "○" : "×"} ${result.prefecture} ${result.name} — ${formatElapsed(result.elapsedMs)}`;
    return item;
  }));
}

function showResults() {
  const { correctCount, totalTimeMs } = scoreSummary();
  elements.quizView.hidden = true;
  elements.resultView.hidden = false;
  elements.resultScore.textContent = `${correctCount} / ${QUESTION_COUNT}`;
  elements.resultTime.textContent = formatElapsed(totalTimeMs);
  renderResultList();

  const shareText = buildShareText({
    dateKey: state.dateKey,
    correctCount,
    elapsedMs: totalTimeMs,
    url: new URL("daily.html", window.location.href).href,
  });
  elements.shareText.value = shareText;
  elements.xShareLink.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
  loadRanking();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderRanking(entries) {
  elements.rankingList.replaceChildren(...entries.map((entry, index) => {
    const item = document.createElement("li");
    item.textContent = `${index + 1}位 ${entry.playerName} — ${entry.correctCount}/5・${formatElapsed(entry.totalTimeMs)}`;
    return item;
  }));
}

async function loadRanking() {
  try {
    const payload = await fetchJson(apiUrl(`/api/rankings?date=${encodeURIComponent(state.dateKey)}`));
    renderRanking(payload.rankings ?? []);
    elements.rankingStatus.textContent = payload.rankings?.length ? "正解数が多く、合計時間が短い順です。" : "今日の登録はまだありません。";
  } catch (error) {
    console.info("ランキングを取得できませんでした。", error.message);
    elements.rankingStatus.textContent = "ランキングに接続できません。結果やX投稿はそのまま利用できます。";
    elements.rankingList.replaceChildren();
  }
}

async function submitRanking(event) {
  event.preventDefault();
  const submitButton = elements.rankingForm.querySelector("button");
  submitButton.disabled = true;
  elements.rankingStatus.textContent = "結果を登録しています…";
  const { correctCount, totalTimeMs } = scoreSummary();

  try {
    await fetchJson(apiUrl("/api/rankings"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        submissionId: state.submissionId,
        dateKey: state.dateKey,
        playerName: elements.playerName.value.trim() || "ゲスト",
        correctCount,
        totalTimeMs,
      }),
    });
    elements.rankingStatus.textContent = "結果を登録しました。";
    await loadRanking();
  } catch (error) {
    console.info("ランキングへ登録できませんでした。", error.message);
    elements.rankingStatus.textContent = "登録できませんでした。クイズ結果やX投稿には影響ありません。";
  } finally {
    submitButton.disabled = false;
  }
}

async function copyShareText() {
  try {
    await navigator.clipboard.writeText(elements.shareText.value);
    elements.copyStatus.textContent = "投稿文をコピーしました。";
  } catch {
    elements.shareText.select();
    elements.copyStatus.textContent = "文面を選択しました。手動でコピーしてください。";
  }
}

elements.startButton.addEventListener("click", startChallenge);
elements.answerForm.addEventListener("submit", submitAnswer);
elements.nextButton.addEventListener("click", goNext);
elements.copyButton.addEventListener("click", copyShareText);
elements.rankingForm.addEventListener("submit", submitRanking);
elements.zoomOutButton.addEventListener("click", () => map.zoomOut());

loadChallenge().catch((error) => {
  elements.dailyDate.textContent = "読み込みエラー";
  elements.loadStatus.textContent = `問題を準備できませんでした。${error.message}`;
});
