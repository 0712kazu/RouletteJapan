export const DAILY_QUESTION_COUNT = 5;
export const SHARE_CHALLENGE_URL = "https://0712kazu.github.io/RouletteJapan/daily.html";

export const DAILY_DIFFICULTY_PLAN = [
  { difficulty: "easy", populationBand: "easy", count: 1 },
  { difficulty: "normal", populationBand: "normal", count: 1 },
  { difficulty: "hard", populationBand: "hard", count: 3 },
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
  let state = hashString(`daily-rotation-v2:${populationBand}`) || 1;
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

  if (DAILY_DIFFICULTY_PLAN.reduce((sum, item) => sum + item.count, 0) !== DAILY_QUESTION_COUNT) {
    throw new Error(`難易度設定は${DAILY_QUESTION_COUNT}問分必要です`);
  }

  DAILY_DIFFICULTY_PLAN.forEach(({ difficulty, populationBand, count }) => {
    if (!availableBands.has(populationBand)) {
      throw new Error(`${populationBand} の人口区分がありません`);
    }
    const candidates = pool.municipalities
      .filter((item) => item.populationBand === populationBand)
      .sort((a, b) => a.code.localeCompare(b.code));
    if (candidates.length < count) throw new Error(`${populationBand} の重複しない問題候補が足りません`);

    const rotation = shuffledForBand(candidates, populationBand);
    const start = (((dayNumber * count) % rotation.length) + rotation.length) % rotation.length;
    for (let offset = 0; offset < count; offset += 1) {
      const selected = rotation[(start + offset) % rotation.length];
      if (selectedCodes.has(selected.code)) throw new Error("同じ日の問題が重複しました");
      selectedCodes.add(selected.code);
      questions.push({ ...selected, difficulty });
    }
  });

  return questions;
}

export function normalizeMunicipalityName(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s/gu, "").toLocaleLowerCase("ja-JP");
}

export function acceptedAnswerForms(question) {
  if (typeof question === "string") return [normalizeMunicipalityName(question)];
  if (!question || typeof question !== "object" || !question.name) return [];

  const prefixes = ["", question.prefecture];
  if (question.district) {
    prefixes.push(question.district, `${question.prefecture}${question.district}`);
  }
  return [...new Set(prefixes.map((prefix) => normalizeMunicipalityName(`${prefix ?? ""}${question.name}`)))];
}

export function isCorrectAnswer(input, question) {
  const normalizedInput = normalizeMunicipalityName(input);
  return normalizedInput.length > 0 && acceptedAnswerForms(question).includes(normalizedInput);
}

function levenshteinDistance(left, right) {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function acceptedAnswerPrefixes(question) {
  if (typeof question === "string") return [""];
  if (!question || typeof question !== "object" || !question.name) return [];

  const prefixes = ["", question.prefecture];
  if (question.district) {
    prefixes.push(question.district, `${question.prefecture ?? ""}${question.district}`);
  }
  return [...new Set(prefixes.map((prefix) => normalizeMunicipalityName(prefix)))];
}

export function isCloseAnswer(input, question) {
  const normalizedInput = normalizeMunicipalityName(input);
  const normalizedName = normalizeMunicipalityName(
    typeof question === "string" ? question : question?.name
  );

  if (!normalizedInput || normalizedName.length <= 2 || isCorrectAnswer(input, question)) {
    return false;
  }

  const maximumDistance = normalizedName.length >= 6 ? 2 : 1;
  return acceptedAnswerPrefixes(question).some((prefix) => {
    if (prefix && !normalizedInput.startsWith(prefix)) return false;
    const municipalityPart = normalizedInput.slice(prefix.length);
    if (!municipalityPart) return false;
    if (Math.abs(municipalityPart.length - normalizedName.length) > maximumDistance) return false;
    return levenshteinDistance(municipalityPart, normalizedName) <= maximumDistance;
  });
}

export function formatElapsed(milliseconds) {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(2)}秒`;
}

export function buildShareText({ correctCount, elapsedMs, rank = null, top = null, rankingAvailable = false }) {
  const lines = [
    "🎯 きょうの市区町村クイズ",
    "",
    `5問中 ${correctCount}問正解`,
    `合計 ${formatElapsed(elapsedMs)}`,
  ];

  const hasTop = top && Number.isInteger(top.correct_count) && Number.isInteger(top.total_time_ms);
  if (rankingAvailable) {
    if (Number.isInteger(rank) && rank > 0) lines.push(`全国 ${rank}位`);
    if (hasTop) {
      lines.push("", "本日の暫定トップ", `${top.correct_count}問正解／${formatElapsed(top.total_time_ms)}`);
    }
  } else {
    lines.push("", "ランキングは現在利用できませんが、クイズは通常どおり遊べます。");
    if (hasTop) {
      lines.push("", "停止前の暫定トップ", `${top.correct_count}問正解／${formatElapsed(top.total_time_ms)}`);
    }
  }

  lines.push(
    "",
    "あなたも挑戦",
    SHARE_CHALLENGE_URL,
    "",
    "制作：@sukyuppa",
    "#市区町村ルーレット #地理クイズ",
  );
  return lines.join("\n");
}
