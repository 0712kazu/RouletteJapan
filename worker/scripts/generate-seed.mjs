import { readFile, writeFile } from "node:fs/promises";

const poolUrl = new URL("../../data/daily-challenge-pool.json", import.meta.url);
const targetUrl = new URL("../migrations/0002_seed_question_pool.sql", import.meta.url);
const pool = JSON.parse(await readFile(poolUrl, "utf8"));

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const values = pool.municipalities.map((item) => `  (${[
  item.code,
  item.name,
  item.prefCode,
  item.prefecture,
  item.populationBand,
].map(sqlString).join(", ")}, 1)`).join(",\n");

const sql = `-- Generated from data/daily-challenge-pool.json by npm run generate:seed.\nINSERT INTO question_pool (code, name, pref_code, prefecture, population_band, active)\nVALUES\n${values}\nON CONFLICT(code) DO UPDATE SET\n  name = excluded.name,\n  pref_code = excluded.pref_code,\n  prefecture = excluded.prefecture,\n  population_band = excluded.population_band,\n  active = excluded.active;\n`;

await writeFile(targetUrl, sql);
