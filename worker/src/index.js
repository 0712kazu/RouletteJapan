import {
  POPULATION_BANDS,
  japanDateKey,
  rowToMunicipality,
  selectDailyQuestions,
  validateScore,
} from "./daily.js";

function corsHeaders(request, env) {
  const requestOrigin = request.headers.get("origin");
  const configuredOrigin = env.ALLOWED_ORIGIN || "";
  const allowedOrigin = configuredOrigin === "*" || requestOrigin === configuredOrigin
    ? (configuredOrigin === "*" ? "*" : requestOrigin)
    : "";

  return {
    ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin } : {}),
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
    "content-type": "application/json; charset=utf-8",
    "vary": "Origin",
  };
}

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(request, env) });
}

async function getDaily(request, env) {
  const { results } = await env.DB.prepare(`
    SELECT code, name, pref_code, prefecture, population_band
    FROM question_pool
    WHERE active = 1
  `).all();
  const dateKey = japanDateKey();
  const questions = selectDailyQuestions(results.map(rowToMunicipality), dateKey);
  return json(request, env, { dateKey, populationBands: POPULATION_BANDS, questions });
}

async function getRankings(request, env, url) {
  const dateKey = url.searchParams.get("date") || japanDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return json(request, env, { error: "日付が不正です" }, 400);

  const { results } = await env.DB.prepare(`
    SELECT player_name, correct_count, total_time_ms
    FROM daily_scores
    WHERE challenge_date = ?
    ORDER BY correct_count DESC, total_time_ms ASC, created_at ASC
    LIMIT 20
  `).bind(dateKey).all();

  return json(request, env, {
    dateKey,
    rankings: results.map((row) => ({
      playerName: row.player_name,
      correctCount: row.correct_count,
      totalTimeMs: row.total_time_ms,
    })),
  });
}

async function postRanking(request, env) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json(request, env, { error: "application/json で送信してください" }, 415);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(request, env, { error: "JSONが不正です" }, 400);
  }

  const validated = validateScore(body, japanDateKey());
  if (validated.error) return json(request, env, { error: validated.error }, 400);
  const score = validated.value;

  await env.DB.prepare(`
    INSERT INTO daily_scores (
      submission_id, challenge_date, player_name, correct_count, total_time_ms
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(submission_id) DO UPDATE SET
      player_name = excluded.player_name,
      correct_count = excluded.correct_count,
      total_time_ms = excluded.total_time_ms
    WHERE daily_scores.challenge_date = excluded.challenge_date
  `).bind(
    score.submissionId,
    score.dateKey,
    score.playerName,
    score.correctCount,
    score.totalTimeMs,
  ).run();

  return json(request, env, { ok: true }, 201);
}

async function route(request, env) {
  if (!env.DB) return json(request, env, { error: "ランキングサービスを利用できません" }, 503);
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/daily") return getDaily(request, env);
  if (request.method === "GET" && url.pathname === "/api/rankings") return getRankings(request, env, url);
  if (request.method === "POST" && url.pathname === "/api/rankings") return postRanking(request, env);
  return json(request, env, { error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    try {
      return await route(request, env);
    } catch (error) {
      console.error("Daily challenge API error", error);
      return json(request, env, { error: "ランキングサービスを利用できません" }, 503);
    }
  },
};
