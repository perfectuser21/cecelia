#!/usr/bin/env bash
# Smoke: reportNode 同步回写 tasks.status (Walking Skeleton P1 B1)
#
# 3 层验证：
#   L1 (静态)  : harness-initiative.graph.js 含 'UPDATE tasks SET status' SQL 锚点
#                + reportNode 同一函数体内 query() 调用 2 次（initiative_runs + tasks）
#   L2 (gate)  : Brain 健康 + DB 可连；不可达 SKIP exit 0 with reason
#   L3 (真验)  : INSERT 一个 fake task → 调 reportNode (PASS) → SELECT status='completed' → cleanup
set -euo pipefail

GRAPH_FILE="packages/brain/src/workflows/harness-initiative.graph.js"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"

# ── L1 静态断言（无网络，永远跑）─────────────────────────────────────────
echo "[smoke] L1: 静态拓扑断言"
test -f "$GRAPH_FILE" || { echo "[smoke] L1 FAIL: $GRAPH_FILE 不存在"; exit 1; }

# 在 reportNode 函数体内必须含 UPDATE tasks SET status 锚点
node -e "
const fs=require('fs');
const src=fs.readFileSync('$GRAPH_FILE','utf8');
const fnMatch=src.match(/export async function reportNode[\s\S]*?\n}\n/);
if(!fnMatch){console.error('reportNode 函数找不到');process.exit(1)}
const body=fnMatch[0];
const hasInitiativeUpdate=/UPDATE\s+initiative_runs/i.test(body);
const hasTaskUpdate=/UPDATE\s+tasks\s+SET\s+status/i.test(body);
if(!hasInitiativeUpdate){console.error('L1 FAIL: reportNode 缺 UPDATE initiative_runs');process.exit(1)}
if(!hasTaskUpdate){console.error('L1 FAIL: reportNode 缺 UPDATE tasks SET status (B1 hole 未修)');process.exit(1)}
console.log('[smoke] L1 PASS: reportNode 同时含 initiative_runs + tasks 写回 SQL');
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

# 连接 precheck — CI 环境 postgres 凭据可能跟本机不同；连不通就 SKIP 不算 fail
if ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: DB 连接失败（$DB 凭据/host 不对，CI env 缺 DATABASE_URL）；L1 静态已 PASS"
  exit 0
fi

TID=$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z' || node -e "console.log(require('crypto').randomUUID())")
echo "[smoke] L3: 真验证 task=$TID"

# 清理函数（trap 保证）
cleanup() {
  psql "$DB" -tAc "DELETE FROM tasks WHERE id='$TID'::uuid" >/dev/null 2>&1 || true
  psql "$DB" -tAc "DELETE FROM initiative_runs WHERE initiative_id='$TID'::uuid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Setup: 模拟 in_progress task + initiative_runs row
psql "$DB" -tAc "INSERT INTO tasks(id, title, status, task_type, priority, created_at, updated_at) VALUES ('$TID'::uuid, '[smoke] B1 reportNode writeback', 'in_progress', 'harness_initiative', 'P2', NOW(), NOW())" >/dev/null
psql "$DB" -tAc "INSERT INTO initiative_runs(initiative_id, phase) VALUES ('$TID'::uuid, 'running')" >/dev/null 2>&1 || true

# 调 reportNode (跨进程 import — 需要在 brain monorepo 跑)
node --input-type=module -e "
import { reportNode } from './packages/brain/src/workflows/harness-initiative.graph.js';
await reportNode({
  initiativeId: '$TID',
  sub_tasks: [{ id: 'sm', cost_usd: 0 }],
  final_e2e_verdict: 'PASS',
});
" 2>&1 | tail -3 || { echo "[smoke] L3 FAIL: reportNode 调用失败"; exit 1; }

# 验证 tasks.status 真被改成 completed
STATUS=$(psql "$DB" -tAc "SELECT status FROM tasks WHERE id='$TID'::uuid")
if [[ "$STATUS" != "completed" ]]; then
  echo "[smoke] L3 FAIL: tasks.status='$STATUS' (期望 'completed')"
  exit 1
fi

echo "[smoke] L3 PASS: reportNode 真把 tasks.status 写到 completed"
echo "[smoke] reportnode-task-writeback OK (L1+L2+L3)"
exit 0
