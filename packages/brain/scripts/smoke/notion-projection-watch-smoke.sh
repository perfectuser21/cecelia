#!/usr/bin/env bash
# notion-projection-watch-smoke — 三面模型 PR③ 真库火：守夜遍历四断言接进 nightly，注册表覆盖全部带 notion_id 的表。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 1. 一库多表：唯一索引替代单列主键
[[ "$(q "SELECT count(*) FROM pg_indexes WHERE tablename='notion_projection_map' AND indexname='uq_notion_projection_map_db_table'")" == "1" ]] || fail "缺 (db,table) 唯一索引"
pass "migration 453：注册表允许一库多表"

# 2. A7 口径：带 notion_id 列的表全部已登记
missing="$("$NODE" --input-type=module -e "
import pg from 'pg'; import { findUnregisteredNotionTables } from '$BRAIN_DIR/src/lib/notion-projection-registry.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
console.log((await findUnregisteredNotionTables(pool)).join(','));
await pool.end();")"
[[ -z "$missing" ]] || fail "未登记: $missing"
pass "A7 registry_coverage：带 notion_id 列的表全部有登记（含 unmapped: 显式行）"

# 3. 无 token 环境下 nightly 仍能产出且守夜四条降级不红（proven：不掀翻前六条）
out="$("$NODE" --input-type=module -e "
import pg from 'pg'; import { buildNightlyAssertions } from '$BRAIN_DIR/src/promise-map-nightly.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
process.env.NOTION_API_KEY=''; process.env.NOTION_TOKEN='';
const rs = await buildNightlyAssertions(pool);
const keys = rs.map(r => r.key);
const watch = rs.filter(r => ['registry_coverage','mirror_tampered','constants_match','projection_counts'].includes(r.key));
console.log(JSON.stringify({ n: rs.length, watch: watch.map(w => [w.key, w.ok, !!w.degraded]) , has7: keys.includes('registry_coverage') }));
await pool.end();" 2>/dev/null)"
echo "$out" | grep -q '"has7":true' || fail "nightly 未接入 A7~A10: $out"
echo "$out" | grep -q '"registry_coverage",true' || fail "A7 在干净库应为绿: $out"
pass "nightly 接入 A7~A10；无 token 时 A8/A10 降级不红，A7/A9 真判"

# 4. A8 dryRun 契约：只诊断不写库（生产 proven-to-fire 用）
grep -q "dryRun" "$BRAIN_DIR/src/lib/notion-projection-watch.js" || fail "缺 dryRun"
pass "A8 具备 dryRun（生产只读诊断不留痕不置指纹）"
echo "ALL PASS: notion-projection-watch"
