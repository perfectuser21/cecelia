#!/usr/bin/env bash
# Smoke: harness_initiative orchestrator 硬校验（2026-07-05 lockdown）
#
# 3 层验证：
#   L1 (静态)  : executor.js 的 _driveHarnessInitiative 含 orchestrator 硬校验锚点
#                （missing_orchestrator_flag 判断先于 compileHarnessFullGraph import）
#   L2 (gate)  : Brain 健康 + DB 可连；不可达 SKIP exit 0 with reason
#   L3 (真验)  : INSERT 一个不带 orchestrator 的 harness_initiative task → 真调
#                runHarnessInitiativeRouter → 断言立即 terminal failed（不 invoke
#                LangGraph 图）→ SELECT tasks.status/failure_class 确认落库 → cleanup
#
# 不覆盖：orchestrator='skill-relay' 的正常路径（会真 spawn docker 容器）——
# 已由 packages/brain/src/__tests__/harness-skill-relay.test.js 单测覆盖，
# 本 smoke 只聚焦本次改动新增的"拒绝"行为。
set -euo pipefail

EXECUTOR_FILE="packages/brain/src/executor.js"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"

# ── L1 静态断言（无网络，永远跑）─────────────────────────────────────────
echo "[smoke] L1: 静态拓扑断言"
test -f "$EXECUTOR_FILE" || { echo "[smoke] L1 FAIL: $EXECUTOR_FILE 不存在"; exit 1; }

node -e "
const fs=require('fs');
const src=fs.readFileSync('$EXECUTOR_FILE','utf8');
const fnMatch=src.match(/async function _driveHarnessInitiative[\s\S]*?\n}\n/);
if(!fnMatch){console.error('_driveHarnessInitiative 函数找不到');process.exit(1)}
const body=fnMatch[0];
const guardIdx=body.indexOf('missing_orchestrator_flag');
const graphImportIdx=body.indexOf('compileHarnessFullGraph');
if(guardIdx===-1){console.error('L1 FAIL: 缺 missing_orchestrator_flag 硬校验锚点');process.exit(1)}
if(graphImportIdx===-1){console.error('L1 FAIL: compileHarnessFullGraph import 找不到（不应被删除，只应变不可达）');process.exit(1)}
if(guardIdx>=graphImportIdx){console.error('L1 FAIL: 硬校验必须先于 compileHarnessFullGraph import（否则不能拦截所有非法 payload）');process.exit(1)}
console.log('[smoke] L1 PASS: orchestrator 硬校验先于 LangGraph 图 import');
" || exit 1

# ── L2 Brain health gate ───────────────────────────────────────────────
if ! curl -sf "$BRAIN/api/brain/health" >/dev/null 2>&1; then
  echo "[smoke] L2 SKIP: Brain 不可达（$BRAIN）— L1 静态已 PASS，L3 跳过"
  exit 0
fi
echo "[smoke] L2 PASS: Brain healthy"

# ── L3 真环境验证 ─────────────────────────────────────────────────────
if ! command -v psql >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: psql 不可用，L3 跳过（L1 静态已 PASS）"
  exit 0
fi

if ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: DB 连接失败（$DB 凭据/host 不对，CI env 缺 DATABASE_URL）；L1 静态已 PASS"
  exit 0
fi

TID=$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z' || node -e "console.log(require('crypto').randomUUID())")
echo "[smoke] L3: task=${TID}, no orchestrator field"

cleanup() {
  psql "$DB" -tAc "DELETE FROM tasks WHERE id='$TID'::uuid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql "$DB" -tAc "INSERT INTO tasks(id, title, status, task_type, priority, payload, created_at, updated_at) VALUES ('$TID'::uuid, '[smoke] orchestrator lockdown', 'in_progress', 'harness_initiative', 'P2', '{}'::jsonb, NOW(), NOW())" >/dev/null

# 真调 runHarnessInitiativeRouter（跨进程 import — 需要在 brain monorepo 跑）
RESULT=$(node --input-type=module -e "
import { runHarnessInitiativeRouter } from './packages/brain/src/executor.js';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: '$DB' });
const { rows } = await pool.query(\"SELECT * FROM tasks WHERE id='$TID'::uuid\");
const task = rows[0];
task.payload = task.payload || {};
const result = await runHarnessInitiativeRouter(task, { pool });
console.log(JSON.stringify(result));
await pool.end();
" 2>&1 | tail -1)

echo "[smoke] router 返回: $RESULT"

node -e "
const r = JSON.parse(process.argv[1]);
if (r.ok !== false) { console.error('L3 FAIL: 期望 ok=false，实际', r.ok); process.exit(1); }
if (r.terminal !== true) { console.error('L3 FAIL: 期望 terminal=true，实际', r.terminal); process.exit(1); }
if (r.error !== 'missing_orchestrator_flag') { console.error('L3 FAIL: 期望 error=missing_orchestrator_flag，实际', r.error); process.exit(1); }
console.log('[smoke] L3 PASS: 无 orchestrator 的 harness_initiative 被立即 terminal failed');
" "$RESULT" || exit 1

# 验证 tasks 表真被写回 failed + failure_class
STATUS=$(psql "$DB" -tAc "SELECT status FROM tasks WHERE id='$TID'::uuid")
FAILURE_CLASS=$(psql "$DB" -tAc "SELECT custom_props->>'failure_class' FROM tasks WHERE id='$TID'::uuid")

if [[ "$STATUS" != "failed" ]]; then
  echo "[smoke] L3 FAIL: tasks.status='$STATUS' (期望 'failed')"
  exit 1
fi
if [[ "$FAILURE_CLASS" != "missing_orchestrator_flag" ]]; then
  echo "[smoke] L3 FAIL: failure_class='$FAILURE_CLASS' (期望 'missing_orchestrator_flag')"
  exit 1
fi

echo "[smoke] L3 PASS: tasks.status='failed' + failure_class='missing_orchestrator_flag' 真落库"
echo "[smoke] harness-orchestrator-lockdown OK (L1+L2+L3)"
exit 0
