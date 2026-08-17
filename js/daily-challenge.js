import {
  buildShareText,
  formatElapsed,
  isCloseAnswer,
  isCorrectAnswer,
  japanDateKey,
  selectDailyQuestions,
} from "./daily-core.mjs";
import { API_BASE_URL } from "./api-config.mjs";

const QUESTION_COUNT = 5;
const QUESTION_INTRO_MS = 2000;
const DEFAULT_PLAYER_NAME = "名無しの地図好き";
const RANKING_UNAVAILABLE_MESSAGE = "ランキングは現在利用できません。クイズは通常どおり遊べます。";
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
  introRankingList: document.getElementById("intro-ranking-list"),
  introRankingStatus: document.getElementById("intro-ranking-status"),
  loadStatus: document.querySelector("#load-status"),
  mapLoading: document.querySelector("#map-loading"),
  mapResetButton: document.querySelector("#map-reset-button"),
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
  rankingSummary: document.querySelector("#ranking-summary"),
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
  initialMapView: null,
  rankingScoreId: null,
  rankingSubmission: null,
};

let mobileViewportBaseline = Math.max(
  window.innerHeight,
  window.visualViewport?.height ?? 0
);

function clearKeyboardLayout() {
  document.body.classList.remove("is-keyboard-visible");
  document.documentElement.style.removeProperty("--daily-visual-height");
  document.documentElement.style.removeProperty("--daily-visual-top");
}

function setQuizPhase(phase) {
  const isAnswering = phase === "answering";
  document.body.classList.toggle("is-daily-answering", isAnswering);
  document.body.classList.toggle("is-answer-feedback", phase === "feedback");

  if (!isAnswering) {
    clearKeyboardLayout();
    mobileViewportBaseline = Math.max(
      window.innerHeight,
      window.visualViewport?.height ?? 0
    );
  }
}

function updateMobileLayout() {
  const isAnswering = document.body.classList.contains("is-daily-answering");
  const isMobile = window.matchMedia("(max-width: 640px)").matches;

  if (!isAnswering || !isMobile) {
    clearKeyboardLayout();
    return;
  }

  const viewport = window.visualViewport;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const viewportTop = viewport?.offsetTop ?? 0;
  const inputFocused = document.activeElement === elements.answerInput;

  if (!inputFocused) {
    mobileViewportBaseline = Math.max(
      mobileViewportBaseline,
      window.innerHeight,
      viewportHeight
    );
  }

  const keyboardThreshold = Math.max(100, mobileViewportBaseline * 0.15);
  const keyboardVisible = inputFocused
    && mobileViewportBaseline - viewportHeight > keyboardThreshold;

  document.documentElement.style.setProperty(
    "--daily-visual-height",
    `${viewportHeight}px`
  );
  document.documentElement.style.setProperty(
    "--daily-visual-top",
    `${viewportTop}px`
  );

  const wasKeyboardVisible = document.body.classList.contains("is-keyboard-visible");
  document.body.classList.toggle("is-keyboard-visible", keyboardVisible);

  if (wasKeyboardVisible !== keyboardVisible) {
    window.requestAnimationFrame(() => map.invalidateSize());
  }
}

function apiUrl(path) {
  const baseUrl = API_BASE_URL.replace(/\/$/, "");
  if (!baseUrl) throw new Error("API URLが未設定です");
  return `${baseUrl}${path}`;
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

function playedCacheKey() {
  return `roulette-japan:daily-played:${state.dateKey}`;
}

function hasPlayedToday() {
  try {
    return localStorage.getItem(playedCacheKey()) === "done";
  } catch {
    return false;
  }
}

function markPlayedToday() {
  try {
    localStorage.setItem(playedCacheKey(), "done");
  } catch (error) {
    console.info("プレイ済み状態を保存できませんでした。", error.name);
  }
}

async function loadChallenge() {
  const pool = await fetchJson("data/daily-challenge-pool.json", {}, 6000);
  state.dateKey = japanDateKey();
  state.questions = selectDailyQuestions(pool, state.dateKey);
  state.bands = new Map(pool.populationBands.map((band) => [band.id, band.label]));
  elements.loadStatus.textContent = "今日の共通問題を準備しました。";

  elements.dailyDate.textContent = formatDateLabel(state.dateKey);
  if (hasPlayedToday()) {
    elements.loadStatus.textContent =
      "本日のチャレンジは完了しました。次回は0:00に新しい問題が配信されます。";
    elements.startButton.disabled = true;
  } else {
    elements.startButton.disabled = false;
  }
  await loadIntroRanking();
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
  const center = map.getCenter();
  state.initialMapView = {
    center: [center.lat, center.lng],
    zoom: map.getZoom(),
  };
  elements.mapResetButton.disabled = true;
  updateZoomOutButton();
}

function zoomOutMap() {
  if (elements.zoomOutButton.disabled) return;
  map.zoomOut();
  elements.mapResetButton.disabled = false;
}

function resetMapView() {
  if (!state.initialMapView) return;
  map.setView(state.initialMapView.center, state.initialMapView.zoom, { animate: false });
  elements.mapResetButton.disabled = true;
}

async function showQuestion() {
  const question = state.questions[state.currentIndex];
  if (state.currentIndex === QUESTION_COUNT - 1) {
    markPlayedToday();
  }
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
    mobileViewportBaseline = Math.max(
      window.innerHeight,
      window.visualViewport?.height ?? 0
    );
    setQuizPhase("answering");
    try {
      elements.answerInput.focus({ preventScroll: true });
    } catch {
      elements.answerInput.focus();
    }
  } catch (error) {
    elements.mapLoading.textContent = `${error.message} 再読み込みしてください。`;
  }
}

function showQuestionIntro() {
  setQuizPhase("intro");
  elements.quizView.hidden = true;
  elements.questionIntroText.textContent = `第${state.currentIndex + 1}問！`;
  elements.questionIntroView.hidden = false;

  window.setTimeout(() => {
    elements.questionIntroView.hidden = true;
    elements.quizView.hidden = false;
    window.requestAnimationFrame(() => {
      updateMobileLayout();
      map.invalidateSize();
      showQuestion();
    });
  }, QUESTION_INTRO_MS);
}

function startChallenge() {
  document.body.classList.add("is-daily-playing");
  elements.introView.hidden = true;
  showQuestionIntro();
}

function submitAnswer(event) {
  event.preventDefault();
  if (elements.answerInput.disabled) return;
  const question = state.questions[state.currentIndex];
  const elapsedMs = Math.max(0, Math.round(performance.now() - state.questionStartedAt));
  const input = elements.answerInput.value;
  const correct = isCorrectAnswer(input, question);
  const close = !correct && isCloseAnswer(input, question);
  state.results.push({ ...question, input, correct, elapsedMs });

  elements.answerInput.blur();
  setQuizPhase("feedback");
  elements.answerInput.disabled = true;
  elements.answerButton.disabled = true;
  elements.feedback.hidden = false;
  elements.feedback.className = `feedback ${correct ? "is-correct" : close ? "is-close" : "is-wrong"}`;
  elements.feedbackTitle.textContent = correct ? "正解！" : close ? "惜しい！" : "不正解";
  elements.feedbackAnswer.textContent = `答え：${question.prefecture} ${question.name}（${formatElapsed(elapsedMs)}）`;
  elements.nextButton.textContent = state.currentIndex === QUESTION_COUNT - 1 ? "結果を見る" : "次の問題へ";
  try {
    elements.nextButton.focus({ preventScroll: true });
  } catch {
    elements.nextButton.focus();
  }
  window.requestAnimationFrame(() => {
    elements.feedback.scrollIntoView({ block: "nearest" });
    map.invalidateSize();
  });
}

function goNext() {
  setQuizPhase("intro");
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
  setQuizPhase("results");
  document.body.classList.remove("is-daily-playing");
  elements.quizView.hidden = true;
  elements.resultView.hidden = false;
  elements.resultScore.textContent = `${correctCount} / ${QUESTION_COUNT}`;
  elements.resultTime.textContent = formatElapsed(totalTimeMs);
  renderResultList();

  updateShareText({ top: loadSavedTopScore(), rankingAvailable: false });
  elements.playerName.value = DEFAULT_PLAYER_NAME;
  state.rankingSubmission = submitDefaultRanking();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateShareText({ rank = null, top = null, rankingAvailable = false } = {}) {
  const { correctCount, totalTimeMs } = scoreSummary();
  const shareText = buildShareText({
    correctCount,
    elapsedMs: totalTimeMs,
    rank,
    top,
    rankingAvailable,
  });
  elements.shareText.value = shareText;
  elements.xShareLink.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
}

function renderRanking(entries) {
  elements.rankingList.replaceChildren(...entries.map((entry, index) => {
    const item = document.createElement("li");
    item.textContent = `${entry.rank ?? index + 1}位 ${entry.player_name} — ${entry.correct_count}/5・${formatElapsed(entry.total_time_ms)}`;
    return item;
  }));
}

function renderIntroRanking(entries) {
  const topTen = entries.slice(0, 10);

  elements.introRankingList.replaceChildren(...topTen.map((entry, index) => {
    const item = document.createElement("li");
    item.textContent =
      `${entry.rank ?? index + 1}位 ${entry.player_name} — ` +
      `${entry.correct_count}/5・${formatElapsed(entry.total_time_ms)}`;
    return item;
  }));
}

async function loadIntroRanking() {
  try {
    const payload = await fetchJson(
      apiUrl(`/ranking?date=${encodeURIComponent(state.dateKey)}`)
    );
    const rankings = payload.rankings ?? [];
    renderIntroRanking(rankings);
    elements.introRankingStatus.textContent = rankings.length
      ? "正解数が多く、合計時間が短い順です。"
      : "今日の登録はまだありません。";
  } catch (error) {
    console.info("開始前ランキングを取得できませんでした。", error.message);
    elements.introRankingStatus.textContent = "ランキングは現在利用できません。";
    elements.introRankingList.replaceChildren();
  }
}

function rankingCacheKey() {
  return `roulette-japan:daily-top:${state.dateKey}`;
}

function saveTopScore(top) {
  if (!top || !Number.isInteger(top.correct_count) || !Number.isInteger(top.total_time_ms)) return;
  try {
    localStorage.setItem(rankingCacheKey(), JSON.stringify({
      correct_count: top.correct_count,
      total_time_ms: top.total_time_ms,
    }));
  } catch (error) {
    console.info("暫定トップをブラウザへ保存できませんでした。", error.name);
  }
}

function loadSavedTopScore() {
  try {
    const saved = JSON.parse(localStorage.getItem(rankingCacheKey()) ?? "null");
    if (!saved || !Number.isInteger(saved.correct_count) || !Number.isInteger(saved.total_time_ms)) return null;
    return saved;
  } catch {
    return null;
  }
}

function renderRankingSummary({ rank = null, top = null, rankingAvailable = true } = {}) {
  const { correctCount, totalTimeMs } = scoreSummary();
  const lines = [`あなたの記録：${correctCount}/5・${formatElapsed(totalTimeMs)}`];
  if (Number.isInteger(rank) && rank > 0) lines.push(`全国順位：${rank}位`);
  if (top) lines.push(`本日の暫定トップ：${top.correct_count}/5・${formatElapsed(top.total_time_ms)}`);
  elements.rankingSummary.replaceChildren(...lines.map((text) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    return paragraph;
  }));
  updateShareText({ rank, top, rankingAvailable });
}

function showRankingUnavailable() {
  renderRankingSummary({ top: loadSavedTopScore(), rankingAvailable: false });
  elements.rankingStatus.textContent = RANKING_UNAVAILABLE_MESSAGE;
  elements.rankingList.replaceChildren();
}

async function loadRanking(rank = null) {
  try {
    const payload = await fetchJson(apiUrl(`/ranking?date=${encodeURIComponent(state.dateKey)}`));
    renderRanking(payload.rankings ?? []);
    const top = payload.top ?? payload.rankings?.[0] ?? null;
    saveTopScore(top);
    renderRankingSummary({ rank, top });
    elements.rankingStatus.textContent = payload.rankings?.length
      ? "正解数が多く、合計時間が短い順です。"
      : "今日の登録はまだありません。";
  } catch (error) {
    console.info("ランキングを取得できませんでした。", error.message);
    if (Number.isInteger(rank) && rank > 0) {
      renderRankingSummary({ rank, top: loadSavedTopScore(), rankingAvailable: false });
      elements.rankingStatus.textContent = RANKING_UNAVAILABLE_MESSAGE;
      elements.rankingList.replaceChildren();
    } else {
      showRankingUnavailable();
    }
  }
}

function rankingScoreBody(playerName) {
  const { correctCount, totalTimeMs } = scoreSummary();
  return {
    play_date: state.dateKey,
    player_name: playerName,
    correct_count: correctCount,
    total_time_ms: totalTimeMs,
  };
}

async function createRankingScore(playerName) {
  return fetchJson(apiUrl("/score"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(rankingScoreBody(playerName)),
  });
}

async function updateRankingName(playerName) {
  return fetchJson(apiUrl(`/score/${state.rankingScoreId}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player_name: playerName }),
  });
}

async function applyRankingResult(payload, message) {
  const scoreId = Number(payload.score?.id);
  if (Number.isInteger(scoreId) && scoreId > 0) state.rankingScoreId = scoreId;
  saveTopScore(payload.top);
  renderRankingSummary({ rank: payload.rank, top: payload.top });
  await loadRanking(payload.rank);
  elements.rankingStatus.textContent = message;
}

async function submitDefaultRanking() {
  const submitButton = elements.rankingForm.querySelector("button");
  submitButton.disabled = true;
  elements.rankingStatus.textContent = `${DEFAULT_PLAYER_NAME}として結果を登録しています…`;

  try {
    const payload = await createRankingScore(DEFAULT_PLAYER_NAME);
    await applyRankingResult(payload, `${DEFAULT_PLAYER_NAME}として結果を登録しました。表示名は変更できます。`);
  } catch (error) {
    console.info("ランキングへ自動登録できませんでした。", error.message);
    showRankingUnavailable();
  } finally {
    submitButton.disabled = false;
  }
}

async function submitRanking(event) {
  event.preventDefault();
  const submitButton = elements.rankingForm.querySelector("button");
  submitButton.disabled = true;
  elements.rankingStatus.textContent = "表示名を反映しています…";
  const playerName = elements.playerName.value.trim() || DEFAULT_PLAYER_NAME;

  try {
    await state.rankingSubmission;
    const updatingExistingScore = Boolean(state.rankingScoreId);
    const payload = updatingExistingScore
      ? await updateRankingName(playerName)
      : await createRankingScore(playerName);
    await applyRankingResult(
      payload,
      updatingExistingScore ? "表示名を変更しました。" : "結果を登録しました。"
    );
  } catch (error) {
    console.info("ランキングへ登録できませんでした。", error.message);
    showRankingUnavailable();
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
elements.zoomOutButton.addEventListener("click", zoomOutMap);
elements.mapResetButton.addEventListener("click", resetMapView);

loadChallenge().catch((error) => {
  elements.dailyDate.textContent = "読み込みエラー";
  elements.loadStatus.textContent = `問題を準備できませんでした。${error.message}`;
});

window.visualViewport?.addEventListener("resize", updateMobileLayout);
window.visualViewport?.addEventListener("scroll", updateMobileLayout);
window.addEventListener("resize", updateMobileLayout);
elements.answerInput.addEventListener("focus", updateMobileLayout);
elements.answerInput.addEventListener("blur", updateMobileLayout);
