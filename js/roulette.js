"use strict";

const JAPAN_BOUNDS = L.latLngBounds([20.2, 122.8], [46.2, 154.1]);
const ROULETTE_DURATION_MS = 1800;
const ROULETTE_TICK_MS = 75;
const ANSWER_DURATION_MS = 5000;

const elements = {
  answer: document.querySelector("#answer"),
  countdown: document.querySelector("#countdown"),
  prefectureSelect: document.querySelector("#prefecture-select"),
  progressText: document.querySelector("#progress-text"),
  resetHistoryButton: document.querySelector("#reset-history-button"),
  resetMapButton: document.querySelector("#reset-map-button"),
  roulette: document.querySelector("#roulette"),
  soundButton: document.querySelector("#sound-button"),
  startButton: document.querySelector("#start-button"),
  statusLabel: document.querySelector("#game-heading"),
};

const map = L.map("map", {
  minZoom: 3,
  maxZoom: 11,
  zoomSnap: 0.5,
}).fitBounds(JAPAN_BOUNDS);

const blankMap = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png", {
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
  maxZoom: 11,
  opacity: 0.84,
}).addTo(map);

const standardMap = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
  maxZoom: 11,
  opacity: 0.72,
});

L.control.layers({ "白地図": blankMap, "標準地図": standardMap }, null, { collapsed: true }).addTo(map);

const sounds = {
  intro: new Audio("audio/intro_part2.mp3"),
  roulette: new Audio("audio/select_part2.mp3"),
  thinking: new Audio("audio/think_part2.mp3"),
};
sounds.intro.loop = true;
sounds.intro.volume = 0.08;
sounds.roulette.volume = 0.22;
sounds.thinking.volume = 0.22;

const state = {
  index: null,
  usedCodes: new Set(),
  dataCache: new Map(),
  layer: null,
  running: false,
  soundEnabled: false,
  timers: new Set(),
};

function setTimer(callback, delay) {
  const timer = window.setTimeout(() => {
    state.timers.delete(timer);
    callback();
  }, delay);
  state.timers.add(timer);
  return timer;
}

function clearTimers() {
  for (const timer of state.timers) window.clearTimeout(timer);
  state.timers.clear();
}

async function safePlay(audio, { restart = true } = {}) {
  if (!state.soundEnabled) return;
  if (restart) audio.currentTime = 0;
  try {
    await audio.play();
  } catch (error) {
    console.info("音声を再生できませんでした。", error.name);
  }
}

function pauseAllSounds() {
  for (const audio of Object.values(sounds)) audio.pause();
}

function municipalitiesInScope() {
  const selectedPrefecture = elements.prefectureSelect.value;
  const all = state.index?.municipalities ?? [];
  return selectedPrefecture === "all"
    ? all
    : all.filter((municipality) => municipality.prefCode === selectedPrefecture);
}

function availableMunicipalities() {
  const scoped = municipalitiesInScope();
  const unused = scoped.filter((municipality) => !state.usedCodes.has(municipality.code));
  if (unused.length > 0) return unused;

  for (const municipality of scoped) state.usedCodes.delete(municipality.code);
  return scoped;
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function setRunning(running) {
  state.running = running;
  elements.startButton.disabled = running;
  elements.prefectureSelect.disabled = running;
  elements.startButton.textContent = running ? "出題中…" : "スタート";
}

function setStatus(label, mainText, answerText = "") {
  elements.statusLabel.textContent = label;
  elements.roulette.textContent = mainText;
  elements.answer.textContent = answerText;
}

function updateProgress() {
  elements.progressText.textContent = `${state.usedCodes.size}問出題`;
}

async function loadPrefecture(prefCode) {
  if (state.dataCache.has(prefCode)) return state.dataCache.get(prefCode);

  const request = fetch(`data/municipalities/${prefCode}.geojson`).then((response) => {
    if (!response.ok) throw new Error(`境界データを取得できませんでした (${response.status})`);
    return response.json();
  });
  state.dataCache.set(prefCode, request);

  try {
    return await request;
  } catch (error) {
    state.dataCache.delete(prefCode);
    throw error;
  }
}

function showMunicipality(feature) {
  if (state.layer) map.removeLayer(state.layer);

  state.layer = L.geoJSON(feature, {
    className: "municipality-shape",
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
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.18), { animate: true, maxZoom: 9 });
}

function hideMunicipality() {
  if (!state.layer) return;
  map.removeLayer(state.layer);
  state.layer = null;
}

function startCountdown(onComplete) {
  const startedAt = Date.now();

  const render = () => {
    const remainingMs = Math.max(0, ANSWER_DURATION_MS - (Date.now() - startedAt));
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    elements.countdown.textContent = remainingSeconds > 0 ? String(remainingSeconds) : "";
    elements.countdown.setAttribute("aria-hidden", remainingSeconds > 0 ? "false" : "true");

    if (remainingMs > 0) {
      setTimer(render, Math.min(200, remainingMs));
    } else {
      onComplete();
    }
  };

  render();
}

async function startRound() {
  if (state.running || !state.index) return;

  clearTimers();
  pauseAllSounds();
  hideMunicipality();
  setRunning(true);
  setStatus("ROULETTE", "選んでいます…");

  const candidates = availableMunicipalities();
  const answer = pickRandom(candidates);
  state.usedCodes.add(answer.code);
  updateProgress();

  const roulettePool = municipalitiesInScope();
  const rouletteTimer = window.setInterval(() => {
    const sample = pickRandom(roulettePool);
    elements.roulette.textContent = `${sample.prefecture} ${sample.name}`;
  }, ROULETTE_TICK_MS);
  safePlay(sounds.roulette);

  try {
    const [geojson] = await Promise.all([
      loadPrefecture(answer.prefCode),
      new Promise((resolve) => setTimer(resolve, ROULETTE_DURATION_MS)),
    ]);
    window.clearInterval(rouletteTimer);

    const feature = geojson.features.find((item) => item.properties.code === answer.code);
    if (!feature) throw new Error(`${answer.code} の境界が見つかりません`);

    setStatus("QUESTION", "このまちはどこ？", "形を見て答えてください");
    showMunicipality(feature);
    safePlay(sounds.thinking);

    startCountdown(() => {
      sounds.thinking.pause();
      elements.countdown.textContent = "";
      elements.countdown.setAttribute("aria-hidden", "true");
      setStatus("ANSWER", `${answer.prefecture} ${answer.name}`, `自治体コード ${answer.code}`);
      setRunning(false);
      safePlay(sounds.intro, { restart: false });
      elements.startButton.focus();
    });
  } catch (error) {
    window.clearInterval(rouletteTimer);
    state.usedCodes.delete(answer.code);
    updateProgress();
    setStatus("ERROR", "読み込みに失敗しました", error.message);
    setRunning(false);
  }
}

function populatePrefectureSelect(prefectures) {
  const fragment = document.createDocumentFragment();
  for (const prefecture of prefectures) {
    const option = document.createElement("option");
    option.value = prefecture.code;
    option.textContent = prefecture.name;
    fragment.append(option);
  }
  elements.prefectureSelect.append(fragment);
}

async function initialize() {
  elements.startButton.disabled = true;
  try {
    const response = await fetch("data/municipalities/index.json");
    if (!response.ok) throw new Error(`一覧データを取得できませんでした (${response.status})`);
    state.index = await response.json();
    populatePrefectureSelect(state.index.prefectures);
    setStatus("READY", `${state.index.municipalities.length.toLocaleString("ja-JP")}市区町村から出題`, "出題範囲を選べます");
    elements.startButton.disabled = false;
  } catch (error) {
    setStatus("ERROR", "ゲームを準備できませんでした", error.message);
  }
}

elements.startButton.addEventListener("click", startRound);

elements.resetMapButton.addEventListener("click", () => {
  map.fitBounds(JAPAN_BOUNDS);
});

elements.resetHistoryButton.addEventListener("click", () => {
  state.usedCodes.clear();
  updateProgress();
  elements.resetHistoryButton.blur();
});

elements.soundButton.addEventListener("click", async () => {
  state.soundEnabled = !state.soundEnabled;
  elements.soundButton.setAttribute("aria-pressed", String(state.soundEnabled));
  elements.soundButton.setAttribute("aria-label", state.soundEnabled ? "音をオフにする" : "音をオンにする");
  elements.soundButton.querySelector("span").textContent = state.soundEnabled ? "🔊" : "🔇";

  if (state.soundEnabled && !state.running) {
    await safePlay(sounds.intro);
  } else if (!state.soundEnabled) {
    pauseAllSounds();
  }
});

initialize();
