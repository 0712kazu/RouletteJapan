export const DAILY_QUESTION_COUNT = 5;

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

export function selectDailyQuestions(pool, dateKey) {
  const bands = pool.populationBands.map((band) => band.id);
  if (bands.length !== DAILY_QUESTION_COUNT) {
    throw new Error(`人口区分は${DAILY_QUESTION_COUNT}種類必要です`);
  }

  return bands.map((band, index) => {
    const candidates = pool.municipalities
      .filter((item) => item.populationBand === band)
      .sort((a, b) => a.code.localeCompare(b.code));
    if (candidates.length === 0) throw new Error(`${band} の問題候補がありません`);
    return candidates[hashString(`${dateKey}:${band}:${index}`) % candidates.length];
  });
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

export function buildShareText({ dateKey, correctCount, elapsedMs, url }) {
  const lines = [
    `市区町村デイリーチャレンジ ${dateKey.replaceAll("-", "/")}`,
    `5問中${correctCount}問正解・合計${formatElapsed(elapsedMs)}`,
    "#市区町村ルーレット #地理クイズ",
  ];
  if (url) lines.push(url);
  return lines.join("\n");
}
