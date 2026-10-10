#!/usr/bin/env bash
# leadgen-notion-registry-smoke — 获客三张 Notion 镜子库登记（迁移 540）+ Activity 页「裁判结论」「生产版本」两列（任务 f6ad056e，决策 a029a7a7）真库真代码火：
# 1. 注册表里三张获客库以 mirror/push/active、brain_table 为空登记；
# 2. 目录源真 SQL（loadDirectorySource）带出每个 Activity 最新一条裁判，buildDirectoryRows 给 Activity 写「裁判结论」「生产版本」两列。
# 只读：不写任何表。纯真 PG + 真函数，无 mock；CI real-env-smoke 在 cecelia_test 上跑。
set -euo pipefail
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-${BRAIN:-http://localhost:5221}}" "${DATABASE_URL:-postgresql://localhost/cecelia}"; then
  exit 0
fi

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"
NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "拒绝连接非测试库: ${DB_NAME:-<empty>}"

q() { "$PSQL" -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# 1. 迁移 540 登记
N="$(q "SELECT count(*) FROM notion_projection_map WHERE title IN ('获客·视频','获客·评论','获客·线索') AND face='mirror' AND direction='push' AND status='active' AND brain_table IS NULL")"
[[ "$N" == "3" ]] || fail "获客三张镜子库登记应为 3 行，实际 ${N}（迁移 540 未跑？）"
pass "迁移 540：获客·视频/评论/线索三张镜子库已登记（mirror/push/active，brain_table 为空）"

# 2. 目录源真 SQL + 真行构造
OUT="$(cd "$BRAIN_DIR" && "$NODE" --input-type=module - <<'NODE'
import pg from 'pg';
import { loadDirectorySource, buildDirectoryRows } from './src/projection/directory-source.js';
import { buildDirectorySchemas } from './src/projection/directory-schema.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const die = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
try {
  const src = await loadDirectorySource(pool);
  if (!Array.isArray(src.judgments)) die('目录源没有 judgments 数组');
  const ids = new Set(src.judgments.map(j => j.activity_id));
  if (ids.size !== src.judgments.length) die('同一 Activity 出现多条裁判（应只取最新一条）');
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const data = { areas: [], journeys: [], workflows: [], steps: [], refs: [], map_nodes: [],
    activities: [{ id: id(6), name: '烟测活动', executor_kind: 'code', contract: {} }],
    judgments: [{ activity_id: id(6), verdict: 'converged', consecutive_green: 3, required_green: 3, judged_at: '2026-10-10T00:00:00Z' }] };
  const row = buildDirectoryRows(data, {}).find(r => r.layer === 'activities');
  const text = p => (p?.rich_text || []).map(t => t.text.content).join('');
  if (text(row.properties['裁判结论']) !== '收敛 · 连续绿 3/3') die(`裁判结论列不对：${text(row.properties['裁判结论'])}`);
  if (!row.properties['生产版本'] || row.properties['生产版本'].rich_text.length !== 0) die('生产版本列应存在且留空');
  const dbs = Object.fromEntries(['areas','value_streams','capabilities','workflows','activities','steps'].map((k, i) => [k, id(900 + i)]));
  const schema = buildDirectorySchemas(dbs).activities;
  if (!schema['裁判结论'] || !schema['生产版本']) die('Activity 库列合同缺两列');
  console.log(`OK judgments=${src.judgments.length}`);
} finally { await pool.end(); }
NODE
)" || fail "目录源/行构造失败"
echo "$OUT" | grep -q '^OK ' || fail "目录源输出异常: $OUT"
pass "目录源真 SQL 带出每个 Activity 最新裁判（${OUT#OK }），Activity 行写出「裁判结论」「生产版本」两列"
