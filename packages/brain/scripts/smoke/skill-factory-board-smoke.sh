#!/usr/bin/env bash
# skill-factory-board-smoke — 技能工厂看板（迁移 543，任务 1b3c0000）+ Activity「生产版本」接发布线 真库真代码火：
# 1. 注册表里「技能工厂看板」以 mirror/push/active、vessel=skill-factory-board、brain_table 为空登记；
# 2. 看板真 SQL（loadBoardSource）在迁移后的库上跑通，buildBoardRows 把一张试跑阶段任务排成一行、列齐全；
# 3. 目录源真 SQL（loadDirectorySource）带出 releases 数组，Activity 行「生产版本」写 v<版本号> + 收敛过/冷启动。
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

# 1. 迁移 543 登记
N="$(q "SELECT count(*) FROM notion_projection_map WHERE title='技能工厂看板' AND vessel='skill-factory-board' AND face='mirror' AND direction='push' AND status='active' AND brain_table IS NULL")"
[[ "$N" == "1" ]] || fail "技能工厂看板登记应为 1 行，实际 ${N}（迁移 543 未跑？）"
pass "迁移 543：技能工厂看板已登记（mirror/push/active，vessel=skill-factory-board）"

# 2+3. 真 SQL + 真行构造
OUT="$(cd "$BRAIN_DIR" && "$NODE" --input-type=module - <<'NODE'
import pg from 'pg';
import { loadBoardSource, buildBoardRows, buildBoardProps, BOARD_DB_PROPS } from './src/skill-factory-board.js';
import { loadDirectorySource, buildDirectoryRows } from './src/projection/directory-source.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const die = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
try {
  await pool.query('SET default_transaction_read_only = on');
  const src = await loadBoardSource(pool);
  if (!Array.isArray(src.stageTasks) || !Array.isArray(src.children) || !Array.isArray(src.workflows)) die('看板源形状不对');
  const body = '【执行参数】\n阶段：试跑\n使用 skill：skill-explore\n树上坐标：部门 · 价值流 · 能力 · 烟测·流程\n';
  const rows = buildBoardRows({ ...src, stageTasks: [{ id: '00000000-0000-4000-8000-000000000001', title: '试跑 烟测', status: 'failed',
    description: body, payload: { stage: 'trial' }, result: { delivery: { claimed_result: 'blocked', fail_reason: '缺命令。后面不要' } },
    created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' }], children: [], followups: [] });
  if (rows.length !== 1) die(`应排出 1 行，实际 ${rows.length}`);
  const p = buildBoardProps(rows[0]);
  if (JSON.stringify(Object.keys(p).sort()) !== JSON.stringify(Object.keys(BOARD_DB_PROPS).sort())) die('看板列与库列合同不一致');
  if (p['最近运行结果'].select.name !== 'blocked' || p['当前阶段'].select.name !== '试跑') die('阶段/运行结果不对');
  if (p['卡点'].rich_text[0].text.content !== '缺命令') die('卡点不是一句话');
  const dir = await loadDirectorySource(pool);
  if (!Array.isArray(dir.releases)) die('目录源没有 releases 数组');
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const row = buildDirectoryRows({ areas: [], journeys: [], workflows: [], steps: [], refs: [], map_nodes: [],
    activities: [{ id: id(6), name: '烟测活动', executor_kind: 'code', contract: {} }],
    releases: [{ activity_id: id(6), version_no: 4, ever_converged: false }] }, {}).find(r => r.layer === 'activities');
  if (row.properties['生产版本'].rich_text[0]?.text.content !== 'v4 · 冷启动（未收敛过）') die('生产版本列不对');
  console.log(`OK stage_tasks=${src.stageTasks.length} releases=${dir.releases.length}`);
} finally { await pool.end(); }
NODE
)" || fail "看板源/目录源构造失败"
echo "$OUT" | grep -q '^OK ' || fail "输出异常: $OUT"
pass "看板真 SQL 跑通并排出一行（${OUT#OK }），目录源带出生产版本"
