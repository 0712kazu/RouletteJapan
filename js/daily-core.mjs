export const DAILY_QUESTION_COUNT = 5;

export const DAILY_DIFFICULTY_PLAN = [
  { difficulty: "easy", populationBand: "mega" },
  { difficulty: "normal", populationBand: "large" },
  { difficulty: "hard", populationBand: "medium" },
  { difficulty: "hard", populationBand: "small" },
  { difficulty: "hard", populationBand: "compact" },
];

export function japanDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function hashString(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function shuffledForBand(candidates, populationBand) {
  const shuffled = [...candidates];
  let state = hashString(`daily-rotation-v1:${populationBand}`) || 1;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const target = (state >>> 0) % (index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function dateOrdinal(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("日付はYYYY-MM-DD形式にしてください");
  const timestamp = Date.parse(`${dateKey}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) throw new Error("日付が不正です");
  return Math.floor(timestamp / 86_400_000);
}

export function selectDailyQuestions(pool, dateKey) {
  const availableBands = new Set(pool.populationBands.map((band) => band.id));
  const selectedCodes = new Set();
  const questions = [];
  const dayNumber = dateOrdinal(dateKey);

  if (DAILY_DIFFICULTY_PLAN.length !== DAILY_QUESTION_COUNT) {
    throw new Error(`難易度設定は${DAILY_QUESTION_COUNT}問分必要です`);
  }

  DAILY_DIFFICULTY_PLAN.forEach(({ difficulty, populationBand }) => {
    if (!availableBands.has(populationBand)) {
      throw new Error(`${populationBand} の人口区分がありません`);
    }
    const candidates = pool.municipalities
      .filter((item) => item.populationBand === populationBand && !selectedCodes.has(item.code))
      .sort((a, b) => a.code.localeCompare(b.code));
    if (candidates.length === 0) throw new Error(`${populationBand} の重複しない問題候補がありません`);

    const rotation = shuffledForBand(candidates, populationBand);
    const selected = rotation[((dayNumber % rotation.length) + rotation.length) % rotation.length];
    selectedCodes.add(selected.code);
    questions.push({ ...selected, difficulty });
  });

  return questions;
}

export function normalizeMunicipalityName(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s　]/g, "").toLocaleLowerCase("ja-JP");
}

export function isCorrectAnswer(input, answer) {
  return normalizeMunicipalityName(input) === normalizeMunicipalityName(answer);
}

export function formatElapsed(milliseconds) {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(2)}秒`;
}

export function buildShareText({ dateKey, correctCount, elapsedMs, rank = null, top = null, url }) {
  const lines = [
    `きょうの市区町村クイズ ${dateKey.replaceAll("-", "/")}`,
    `5問中${correctCount}問正解・合計${formatElapsed(elapsedMs)}`,
  ];
  if (Number.isInteger(rank) && rank > 0) lines.push(`全国順位：${rank}位`);
  if (top && Number.isInteger(top.correct_count) && Number.isInteger(top.total_time_ms)) {
    lines.push(`本日の暫定トップ：${top.correct_count}/5・${formatElapsed(top.total_time_ms)}`);
  }
  lines.push("#市区町村ルーレット #地理クイズ");
  if (url) lines.push(url);
  return lines.join("\n");
}
