#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
OUTPUT_DIR="$ROOT_DIR/data/municipalities"
SOURCE_BASE="https://nlftp.mlit.go.jp/ksj/gml/data/N03"
SIMPLIFY_TOLERANCE=${SIMPLIFY_TOLERANCE:-0.0015}
PREF_CODES=${PREF_CODES:-$(seq -w 1 47)}

if [[ -z "${PROJ_DATA:-}" ]] && command -v brew >/dev/null 2>&1; then
  PROJ_DATA="$(brew --prefix proj)/share/proj"
  export PROJ_DATA
fi

if ! command -v ogr2ogr >/dev/null 2>&1; then
  echo "ogr2ogr (GDAL) が必要です。" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/roulette-n03.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT

download_prefecture() {
  local pref_code=$1
  local year url zip_file

  for year in 2026 2025 2024 2023; do
    url="$SOURCE_BASE/N03-$year/N03-${year}0101_${pref_code}_GML.zip"
    zip_file="$WORK_DIR/${pref_code}.zip"
    if curl --fail --location --silent --show-error "$url" --output "$zip_file"; then
      printf '%s' "$year"
      return 0
    fi
  done

  echo "都道府県コード ${pref_code} のデータを取得できませんでした。" >&2
  return 1
}

for pref_code in $PREF_CODES; do
  echo "[$pref_code] downloading..."
  year=$(download_prefecture "$pref_code")
  extract_dir="$WORK_DIR/$pref_code"
  mkdir -p "$extract_dir"
  unzip -q "$WORK_DIR/${pref_code}.zip" '*.geojson' -d "$extract_dir"
  source_file="$extract_dir/N03-${year}0101_${pref_code}.geojson"
  if [[ ! -f "$source_file" ]]; then
    echo "[$pref_code] expected GeoJSON file is missing." >&2
    exit 1
  fi
  layer_name=$(basename "$source_file" .geojson)
  processed_file="$WORK_DIR/${pref_code}-processed.geojson"

  echo "[$pref_code] processing ${year} data..."
  ogr2ogr \
    -f GeoJSON \
    "$processed_file" \
    "$source_file" \
    -dialect SQLite \
    -sql "SELECT CASE WHEN MAX(N03_005) IS NOT NULL THEN SUBSTR(MIN(N03_007), 1, 4) || '0' ELSE MIN(N03_007) END AS code, MAX(N03_001) AS prefecture, MAX(N03_004) AS name, '${year}' AS sourceYear, ST_Union(geometry) AS geometry FROM '${layer_name}' WHERE N03_007 IS NOT NULL AND N03_004 IS NOT NULL AND N03_007 NOT LIKE '%000' GROUP BY CASE WHEN N03_005 IS NOT NULL THEN N03_001 || ':' || N03_004 ELSE N03_007 END" \
    -simplify "$SIMPLIFY_TOLERANCE" \
    -lco COORDINATE_PRECISION=5
  mv "$processed_file" "$OUTPUT_DIR/${pref_code}.geojson"
done

node - "$OUTPUT_DIR" <<'NODE'
const fs = require("fs");
const path = require("path");
const outputDirectory = process.argv[2];
const municipalities = [];
const prefectureMap = new Map();

for (let prefNumber = 1; prefNumber <= 47; prefNumber += 1) {
  const prefCode = String(prefNumber).padStart(2, "0");
  const filePath = path.join(outputDirectory, `${prefCode}.geojson`);
  if (!fs.existsSync(filePath)) continue;
  const geojson = JSON.parse(fs.readFileSync(filePath, "utf8"));

  for (const feature of geojson.features) {
    const { code, name, prefecture, sourceYear } = feature.properties;
    if (!code || !name || !prefecture) continue;
    municipalities.push({ code, name, prefCode, prefecture, sourceYear });
    prefectureMap.set(prefCode, prefecture);
  }
}

municipalities.sort((a, b) => a.code.localeCompare(b.code, "ja"));
const prefectures = [...prefectureMap]
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.code.localeCompare(b.code));

const index = {
  generatedAt: new Date().toISOString(),
  source: "国土交通省 国土数値情報（行政区域データ N03）",
  prefectures,
  municipalities,
};
fs.writeFileSync(path.join(outputDirectory, "index.json"), `${JSON.stringify(index)}\n`);
console.log(`${municipalities.length} municipalities written.`);
NODE
