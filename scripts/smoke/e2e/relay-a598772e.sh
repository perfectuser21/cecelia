#!/usr/bin/env bash
# e2e-verify.sh — harness relay grok executor 收编 Final E2E 验收脚本
# TASK_ID: a598772e-7f74-40f0-a022-d0e8d2b35dc0
# SPRINT_DIR: sprints/07201315-relay-a598772e
# target_environment: local_api
#
# 用法：
#   bash sprints/07201315-relay-a598772e/e2e-verify.sh [TASK_ID]
#
# 若不传 TASK_ID，使用脚本内默认值（本 sprint task id）。
# 所有验收点 PASS → exit 0；任一 FAIL → exit 1。

set -euo pipefail

TASK_ID="${1:-a598772e-7f74-40f0-a022-d0e8d2b35dc0}"
SHORT=$(echo "$TASK_ID" | tr -d '-' | cut -c1-8)
CONTAINER="cecelia-relay-${SHORT}-gk"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS=0
FAIL=0

pass() { echo "PASS $1: $2"; PASS=$((PASS+1)); }
fail() { echo "FAIL $1: $2"; FAIL=$((FAIL+1)); }

echo "=========================================="
echo " grok relay E2E 验收"
echo " TASK_ID : $TASK_ID"
echo " CONTAINER: $CONTAINER"
echo " BRAIN_URL: $BRAIN_URL"
echo "=========================================="

# ── E1: grok 二进制实跑证明 ──────────────────────────────────────────────────
echo ""
echo "[E1] grok 二进制实跑证明（docker logs 含 grok 关键字）..."
if docker logs "$CONTAINER" 2>&1 | grep -qE "grok"; then
  pass "E1" "grok binary confirmed in container logs (container=${CONTAINER})"
else
  fail "E1" "grok binary keyword not found in logs of ${CONTAINER} — 可能容器未启动或 executor 不是 grok"
fi

# ── E2: 任务 status=completed ─────────────────────────────────────────────────
echo ""
echo "[E2] 任务 status=completed..."
TASK_JSON=$(curl -sf "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null || echo '{}')
STATUS=$(echo "$TASK_JSON" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")
if [ "$STATUS" = "completed" ]; then
  pass "E2" "task status=completed"
else
  fail "E2" "task status=${STATUS}（期望 completed）"
fi

# ── E3: initiative_runs phase=done ────────────────────────────────────────────
echo ""
echo "[E3] initiative_runs phase=done..."
PHASE=$(psql "${PGDATABASE:-cecelia}" -At -c \
  "SELECT phase FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY created_at DESC LIMIT 1" \
  2>/dev/null || echo "")
if [ "$PHASE" = "done" ]; then
  pass "E3" "initiative_runs phase=done"
else
  fail "E3" "initiative_runs phase=${PHASE:-<empty>}（期望 done）"
fi

# ── E4: PR URL 产出 ──────────────────────────────────────────────────────────
echo ""
echo "[E4] PR URL 产出验证..."
PR_URL=$(echo "$TASK_JSON" | jq -r '.result.pr_url // empty' 2>/dev/null || echo "")
if [ -z "$PR_URL" ]; then
  # 尝试从 initiative_runs 查
  PR_URL=$(psql "${PGDATABASE:-cecelia}" -At -c \
    "SELECT result->>'pr_url' FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY created_at DESC LIMIT 1" \
    2>/dev/null || echo "")
fi
if [ -n "$PR_URL" ]; then
  pass "E4" "PR URL=${PR_URL}"
else
  fail "E4" "PR URL 为空（task result 和 initiative_runs 均未找到 pr_url）"
fi

# ── E5: 容器挂载含 .grok ─────────────────────────────────────────────────────
echo ""
echo "[E5] 容器 .grok 挂载验证..."
MOUNTS=$(docker inspect "$CONTAINER" 2>/dev/null \
  | jq -r '.[].HostConfig.Binds[]?' 2>/dev/null \
  || echo "")
if echo "$MOUNTS" | grep -q ".grok"; then
  pass "E5" ".grok mount found in container binds"
else
  fail "E5" ".grok mount not found — docker inspect ${CONTAINER} HostConfig.Binds: ${MOUNTS:-<empty>}"
fi

# ── E6: orchestrator_host=skill-relay-grok ────────────────────────────────────
echo ""
echo "[E6] orchestrator_host=skill-relay-grok 验证..."
ORC_HOST=$(psql "${PGDATABASE:-cecelia}" -At -c \
  "SELECT orchestrator_host FROM initiative_runs WHERE initiative_id='${TASK_ID}' ORDER BY created_at DESC LIMIT 1" \
  2>/dev/null || echo "")
if [ "$ORC_HOST" = "skill-relay-grok" ]; then
  pass "E6" "orchestrator_host=skill-relay-grok"
else
  fail "E6" "orchestrator_host=${ORC_HOST:-<empty>}（期望 skill-relay-grok）"
fi

# ── E7: 撞墙 fallback 单测 ───────────────────────────────────────────────────
echo ""
echo "[E7] quota fallback 单测..."
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if cd "$REPO_ROOT" && npm test packages/brain/src/__tests__/harness-skill-relay.test.js \
    -- --grep "quota|detectQuotaWall|fallback" 2>&1 | tail -5; then
  pass "E7" "quota fallback tests pass"
else
  fail "E7" "quota fallback tests failed — 见上方 npm test 输出"
fi

# ── E8: 全量 relay 回归测试 ───────────────────────────────────────────────────
echo ""
echo "[E8] 全量 harness-skill-relay 回归测试..."
if cd "$REPO_ROOT" && npm test packages/brain/src/__tests__/harness-skill-relay.test.js 2>&1 | tail -10; then
  pass "E8" "all relay tests pass (isCodex/claude 路径回归保护)"
else
  fail "E8" "relay regression test failed — 见上方 npm test 输出"
fi

# ── 汇总 ─────────────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo " 验收汇总: PASS=${PASS}  FAIL=${FAIL}"
echo "=========================================="

if [ "$FAIL" -gt 0 ]; then
  echo "RESULT: FAIL（${FAIL} 项未通过）"
  exit 1
else
  echo "RESULT: PASS（全部 ${PASS} 项通过）"
  exit 0
fi
