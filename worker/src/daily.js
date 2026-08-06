export const POPULATION_BANDS = [
  { id: "mega", label: "50万人以上" },
  { id: "large", label: "20万〜50万人未満" },
  { id: "medium", label: "10万〜20万人未満" },
  { id: "small", label: "3万〜10万人未満" },
  { id: "compact", label: "3万人未満" },
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

export function selectDailyQuestions(municipalities, dateKey) {
  return POPULATION_BANDS.map((band, index) => {
    const candidates = municipalities
      .filter((item) => item.populationBand === band.id)
      .sort((a, b) => a.code.localeCompare(b.code));
    if (candidates.length === 0) throw new Error(`${band.id} の問題候補がありません`);
    return candidates[hashString(`${dateKey}:${band.id}:${index}`) % candidates.length];
  });
}

export function rowToMunicipality(row) {
  return {
    code: row.code,
    name: row.name,
    prefCode: row.pref_code,
    prefecture: row.prefecture,
    populationBand: row.population_band,
  };
}

export function validateScore(input, expectedDate) {
  const submissionId = String(input?.submissionId ?? "");
  const dateKey = String(input?.dateKey ?? "");
  const playerName = String(input?.playerName ?? "").trim();
  const correctCount = Number(input?.correctCount);
  const totalTimeMs = Number(input?.totalTimeMs);

  if (!/^[a-zA-Z0-9-]{8,80}$/.test(submissionId)) return { error: "submissionId が不正です" };
  if (dateKey !== expectedDate) return { error: "今日のチャレンジ結果のみ登録できます" };
  if (!playerName || playerName.length > 20) return { error: "表示名は1〜20文字で入力してください" };
  if (!Number.isInteger(correctCount) || correctCount < 0 || correctCount > 5) return { error: "正解数が不正です" };
  if (!Number.isInteger(totalTimeMs) || totalTimeMs < 0 || totalTimeMs > 3_600_000) return { error: "回答時間が不正です" };

  return { value: { submissionId, dateKey, playerName, correctCount, totalTimeMs } };
}
