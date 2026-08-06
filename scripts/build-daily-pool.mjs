#!/usr/bin/env node

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");
const n03Directory = process.argv[2];

if (!n03Directory) {
  console.error("使い方: node scripts/build-daily-pool.mjs /path/to/extracted-n03-root");
  process.exit(1);
}

const populationExceptions = new Set([
  "01695", // 色丹村
  "01696", // 泊村
  "01697", // 留夜別村
  "01698", // 留別村
  "01699", // 紗那村
  "01700", // 蘂取村
  "07546", // 双葉町（令和2年国勢調査の総人口が「－」）
]);

function municipalityType(item) {
  if (item.prefCode === "13" && item.name.endsWith("区")) return "tokyoWard";
  if (item.name.endsWith("市")) return "city";
  if (item.name.endsWith("町")) return "town";
  if (item.name.endsWith("村")) return "village";
  throw new Error(`自治体種別を判定できません: ${item.code} ${item.name}`);
}

function populationBand(population, code) {
  if (populationExceptions.has(code)) return "hard";
  if (!Number.isInteger(population) || population < 0) {
    throw new Error(`人口がありません: ${code}`);
  }
  if (population >= 200_000) return "easy";
  if (population >= 50_000) return "normal";
  return "hard";
}

async function findN03File(prefCode) {
  const directory = path.resolve(n03Directory, prefCode);
  const names = await readdir(directory);
  const name = names.find((candidate) => /^N03-\d{8}_\d{2}\.geojson$/.test(candidate));
  if (!name) throw new Error(`${prefCode} のN03 GeoJSONが見つかりません`);
  return path.join(directory, name);
}

async function loadDistricts() {
  const municipalities = new Map();
  for (let value = 1; value <= 47; value += 1) {
    const prefCode = String(value).padStart(2, "0");
    const geojson = JSON.parse(await readFile(await findN03File(prefCode), "utf8"));
    for (const feature of geojson.features) {
      const properties = feature.properties;
      if (!properties.N03_007 || !properties.N03_004) continue;
      const code = properties.N03_005
        ? `${properties.N03_007.slice(0, 4)}0`
        : properties.N03_007;
      const item = {
        prefecture: properties.N03_001,
        name: properties.N03_004,
        district: properties.N03_005 ? null : (properties.N03_003 ?? null),
      };
      const existing = municipalities.get(code);
      if (existing && JSON.stringify(existing) !== JSON.stringify(item)) {
        throw new Error(`N03内で自治体属性が一致しません: ${code}`);
      }
      municipalities.set(code, item);
    }
  }
  return municipalities;
}

const index = JSON.parse(await readFile(path.join(rootDirectory, "data/municipalities/index.json"), "utf8"));
const census = JSON.parse(await readFile(path.join(rootDirectory, "data/census-2020-municipality-population.json"), "utf8"));
const n03Municipalities = await loadDistricts();
const codes = new Set();

const municipalities = index.municipalities.map((item) => {
  if (codes.has(item.code)) throw new Error(`自治体コードが重複しています: ${item.code}`);
  codes.add(item.code);

  const n03 = n03Municipalities.get(item.code);
  if (!n03 || n03.prefecture !== item.prefecture || n03.name !== item.name) {
    throw new Error(`全国自治体索引とN03が一致しません: ${item.code}`);
  }

  const population = census.populations[item.code] ?? null;
  if (population === null && !populationExceptions.has(item.code)) {
    throw new Error(`承認されていない人口欠損です: ${item.code} ${item.name}`);
  }
  if (population !== null && populationExceptions.has(item.code)) {
    throw new Error(`人口例外に数値人口があります。例外設定を見直してください: ${item.code}`);
  }

  return {
    code: item.code,
    name: item.name,
    prefCode: item.prefCode,
    prefecture: item.prefecture,
    district: n03.district,
    municipalityType: municipalityType(item),
    population,
    populationBand: populationBand(population, item.code),
    populationStatus: population === null ? "official-data-unavailable" : "available",
  };
});

if (municipalities.length !== 1747) {
  throw new Error(`全国自治体件数が想定外です: ${municipalities.length}`);
}

const output = {
  version: 2,
  populationReference: {
    year: 2020,
    name: "令和2年国勢調査 都道府県・市区町村別の主な結果",
    url: census.sourceUrl,
    unavailablePolicy: "公式数値のない7町村は承認済み例外として難しいに分類",
  },
  boundaryReference: {
    year: 2026,
    name: "国土交通省 国土数値情報（行政区域データ N03）",
  },
  populationBands: [
    { id: "easy", label: "20万人以上", questionsPerDay: 1 },
    { id: "normal", label: "5万人以上20万人未満", questionsPerDay: 1 },
    { id: "hard", label: "5万人未満", questionsPerDay: 3 },
  ],
  municipalities,
};

const metadataLines = JSON.stringify({ ...output, municipalities: undefined }, null, 2).split("\n");
metadataLines[metadataLines.length - 2] += ",";
metadataLines[metadataLines.length - 1] = "  \"municipalities\": [";
const municipalityLines = municipalities.map((item, index) => (
  `    ${JSON.stringify(item)}${index === municipalities.length - 1 ? "" : ","}`
));
const serialized = [...metadataLines, ...municipalityLines, "  ]", "}", ""].join("\n");

await writeFile(
  path.join(rootDirectory, "data/daily-challenge-pool.json"),
  serialized,
);

const counts = municipalities.reduce((result, item) => {
  result[item.populationBand] += 1;
  return result;
}, { easy: 0, normal: 0, hard: 0 });
console.log(`全国 ${municipalities.length}件（easy ${counts.easy} / normal ${counts.normal} / hard ${counts.hard}）`);
