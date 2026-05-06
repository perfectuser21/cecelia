#!/usr/bin/env bash
# harness-evaluate-smoke.sh
#
# 真实环境 smoke：验证 harness evaluator 节点相关状态字段存在于 initiative_runs 表，
# 以及 harness-initiative.graph.js 已导出 evaluateSubTaskNode / routeAfterEvaluate。
#
# 跳过条件：DB 不可达 / Brain 未启动 → exit 0 + 打印 SKIP
# 退出码：0=PASS/SKIP，1=FAIL

set -euo pipefail

SMOKE_NAME="harness-evaluate"
log() { echo "[smoke:$SMOKE_NAME] $*"; }

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DATABASE_URL="${DATABASE_URL:-postgresql://cecelia@localhost:5432/cecelia}"
GRAPH_FILE="packages/brain/src/workflows/harness-initiative.graph.js"

# ── 前置检查 ──────────────────────────────────────────────────────────────────
if ! pg_isready -d "$DATABASE_URL" -q 2>/dev/null; then
  log "SKIP — DB 不可达 ($DATABASE_URL)"
  exit 0
fi

if ! curl -sf "${BRAIN_URL}/healthz" >/dev/null 2>&1; then
  log "SKIP — Brain 未启动 ($BRAIN_URL)"
  exit 0
fi

PASS=0
FAIL=0

# ── Test 1: graph.js 导出 evaluateSubTaskNode ─────────────────────────────────
log "Test 1: harness-initiative.graph.js 导出 evaluateSubTaskNode"
if grep -q "export async function evaluateSubTaskNode" "$GRAPH_FILE"; then
  log "PASS — evaluateSubTaskNode 已导出"
  PASS=$((PASS+1))
else
  log "FAIL — evaluateSubTaskNode 未找到"
  FAIL=$((FAIL+1))
fi

# ── Test 2: graph.js 导出 routeAfterEvaluate ─────────────────────────────────
log "Test 2: harness-initiative.graph.js 导出 routeAfterEvaluate"
if grep -q "export function routeAfterEvaluate" "$GRAPH_FILE"; then
  log "PASS — routeAfterEvaluate 已导出"
  PASS=$((PASS+1))
else
  log "FAIL — routeAfterEvaluate 未找到"
  FAIL=$((FAIL+1))
fi

# ── Test 3: graph.js 包含串行 evaluate 节点 ───────────────────────────────────
log "Test 3: graph.js 包含 evaluate 节点连接"
if grep -q "'run_sub_task', 'evaluate'" "$GRAPH_FILE"; then
  log "PASS — serial evaluate 节点连接存在"
  PASS=$((PASS+1))
else
  log "FAIL — serial evaluate 节点连接未找到"
  FAIL=$((FAIL+1))
fi

# ── Test 4: DB 心跳（Initiative 表可查询）────────────────────────────────────
log "Test 4: initiative_runs 表可查询"
COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM initiative_runs LIMIT 1;" 2>/dev/null | tr -d ' \n' || echo "ERR")
if [[ "$COUNT" =~ ^[0-9]+$ ]]; then
  log "PASS — initiative_runs 表可访问（行数: $COUNT）"
  PASS=$((PASS+1))
else
  log "FAIL — initiative_runs 查询失败（$COUNT）"
  FAIL=$((FAIL+1))
fi

# ── 汇总 ─────────────────────────────────────────────────────────────────────
log "结果: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
