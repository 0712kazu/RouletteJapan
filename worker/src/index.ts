interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
}

interface ScoreInput {
  play_date: string;
  player_name: string;
  correct_count: number;
  total_time_ms: number;
}

interface ScoreRow extends ScoreInput {
  id: number;
  created_at: string;
}

interface RankRow {
  rank: number;
}

const MAX_TOTAL_TIME_MS = 30 * 60 * 1000;
const RANKING_LIMIT = 100;
const DEFAULT_PRODUCTION_ORIGINS = ["https://0712kazu.github.io"];

function assignCompetitionRanks(scores: ScoreRow[]): Array<ScoreRow & { rank: number }> {
  let previousKey: string | null = null;
  let rank = 0;
  return scores.map((score, index) => {
    const key = `${score.correct_count}:${score.total_time_ms}`;
    if (key !== previousKey) rank = index + 1;
    previousKey = key;
    return { rank, ...score };
  });
}

function allowedOrigins(env: Env): Set<string> {
  const configured = env.ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set(configured?.length ? configured : DEFAULT_PRODUCTION_ORIGINS);
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
    "access-control-max-age": "86400",
    "content-type": "application/json; charset=utf-8",
    "vary": "Origin",
  });
  const origin = request.headers.get("origin")?.replace(/\/$/, "");
  if (origin && allowedOrigins(env).has(origin)) {
    headers.set("access-control-allow-origin", origin);
  }
  return headers;
}

function json(request: Request, env: Env, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request, env) });
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateScore(value: unknown): { value?: ScoreInput; error?: string } {
  if (!value || typeof value !== "object") return { error: "リクエスト本文が不正です" };
  const input = value as Record<string, unknown>;
  if (!isValidDate(input.play_date)) return { error: "play_dateはYYYY-MM-DD形式の実在する日付にしてください" };

  const playerName = typeof input.player_name === "string" ? input.player_name.trim() : "";
  const playerNameLength = Array.from(playerName).length;
  if (playerNameLength < 1 || playerNameLength > 20) return { error: "player_nameは1文字以上20文字以内にしてください" };

  if (!Number.isInteger(input.correct_count) || Number(input.correct_count) < 0 || Number(input.correct_count) > 5) {
    return { error: "correct_countは0以上5以下の整数にしてください" };
  }
  if (!Number.isInteger(input.total_time_ms) || Number(input.total_time_ms) <= 0 || Number(input.total_time_ms) > MAX_TOTAL_TIME_MS) {
    return { error: `total_time_msは1以上${MAX_TOTAL_TIME_MS}以下の整数にしてください` };
  }

  return {
    value: {
      play_date: input.play_date,
      player_name: playerName,
      correct_count: Number(input.correct_count),
      total_time_ms: Number(input.total_time_ms),
    },
  };
}

async function getTopScore(env: Env, playDate: string): Promise<ScoreRow | null> {
  return env.DB.prepare(`
    SELECT id, play_date, player_name, correct_count, total_time_ms, created_at
    FROM daily_scores
    WHERE play_date = ?
    ORDER BY correct_count DESC, total_time_ms ASC, created_at ASC, id ASC
    LIMIT ?
  `).bind(playDate, 1).first<ScoreRow>();
}

async function handleHealth(request: Request, env: Env): Promise<Response> {
  try {
    const row = await env.DB.prepare("SELECT ? AS ok").bind(1).first<{ ok: number }>();
    if (row?.ok !== 1) throw new Error("Unexpected health result");
    return json(request, env, { status: "ok", database: "ok" });
  } catch (error) {
    console.error("D1 health check failed", error);
    return json(request, env, { status: "error", database: "error" }, 503);
  }
}

async function handleRanking(request: Request, env: Env, url: URL): Promise<Response> {
  const playDate = url.searchParams.get("date");
  if (!isValidDate(playDate)) return json(request, env, { error: "dateはYYYY-MM-DD形式の実在する日付にしてください" }, 400);

  const result = await env.DB.prepare(`
    SELECT id, play_date, player_name, correct_count, total_time_ms, created_at
    FROM daily_scores
    WHERE play_date = ?
    ORDER BY correct_count DESC, total_time_ms ASC, created_at ASC, id ASC
    LIMIT ?
  `).bind(playDate, RANKING_LIMIT).all<ScoreRow>();

  const rankings = assignCompetitionRanks(result.results);
  return json(request, env, { play_date: playDate, rankings, top: rankings[0] ?? null });
}

async function handleScore(request: Request, env: Env): Promise<Response> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json(request, env, { error: "Content-Typeはapplication/jsonにしてください" }, 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(request, env, { error: "JSONが不正です" }, 400);
  }

  const validated = validateScore(body);
  if (!validated.value) return json(request, env, { error: validated.error }, 400);
  const score = validated.value;
  const createdAt = new Date().toISOString();

  const insert = await env.DB.prepare(`
    INSERT INTO daily_scores (play_date, player_name, correct_count, total_time_ms, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    score.play_date,
    score.player_name,
    score.correct_count,
    score.total_time_ms,
    createdAt,
  ).run();

  const id = Number(insert.meta.last_row_id);
  const rankRow = await env.DB.prepare(`
    SELECT COUNT(*) + 1 AS rank
    FROM daily_scores
    WHERE play_date = ? AND (
      correct_count > ? OR
      (correct_count = ? AND total_time_ms < ?)
    )
  `).bind(
    score.play_date,
    score.correct_count,
    score.correct_count,
    score.total_time_ms,
  ).first<RankRow>();
  const top = await getTopScore(env, score.play_date);

  return json(request, env, {
    status: "ok",
    score: { id, ...score, created_at: createdAt },
    rank: rankRow?.rank ?? null,
    top,
  }, 201);
}

async function handleScoreNameUpdate(request: Request, env: Env, id: number): Promise<Response> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json(request, env, { error: "Content-Typeはapplication/jsonにしてください" }, 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(request, env, { error: "JSONが不正です" }, 400);
  }

  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const playerName = typeof input.player_name === "string" ? input.player_name.trim() : "";
  const playerNameLength = Array.from(playerName).length;
  if (playerNameLength < 1 || playerNameLength > 20) {
    return json(request, env, { error: "player_nameは1文字以上20文字以内にしてください" }, 400);
  }

  const score = await env.DB.prepare(`
    SELECT id, play_date, player_name, correct_count, total_time_ms, created_at
    FROM daily_scores
    WHERE id = ?
  `).bind(id).first<ScoreRow>();
  if (!score) return json(request, env, { error: "記録が見つかりません" }, 404);

  await env.DB.prepare(`
    UPDATE daily_scores
    SET player_name = ?
    WHERE id = ?
  `).bind(playerName, id).run();

  const rankRow = await env.DB.prepare(`
    SELECT COUNT(*) + 1 AS rank
    FROM daily_scores
    WHERE play_date = ? AND (
      correct_count > ? OR
      (correct_count = ? AND total_time_ms < ?)
    )
  `).bind(
    score.play_date,
    score.correct_count,
    score.correct_count,
    score.total_time_ms,
  ).first<RankRow>();
  const top = await getTopScore(env, score.play_date);

  return json(request, env, {
    status: "ok",
    score: { ...score, player_name: playerName },
    rank: rankRow?.rank ?? null,
    top,
  });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") return handleHealth(request, env);
  if (request.method === "GET" && url.pathname === "/ranking") return handleRanking(request, env, url);
  if (request.method === "POST" && url.pathname === "/score") return handleScore(request, env);
  const scorePathMatch = url.pathname.match(/^\/score\/(\d+)$/);
  if (request.method === "PATCH" && scorePathMatch) {
    return handleScoreNameUpdate(request, env, Number(scorePathMatch[1]));
  }
  return json(request, env, { error: "Not found" }, 404);
}

const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    try {
      return await route(request, env);
    } catch (error) {
      console.error("API request failed", error);
      return json(request, env, { error: "APIは現在利用できません" }, 503);
    }
  },
};

export { assignCompetitionRanks, isValidDate, validateScore };
export default worker;
