#!/usr/bin/env bash
# ============================================================
# contract-red.test.sh — headless dispatch smoke 565fa27a
# Task ID: 565fa27a-4b5b-4eb7-905e-b6fb61eb8413
# Sprint: 07191541-relay-565fa27a
#
# 初始状态：RED
# 设计意图：在 Brain payload 尚未写入 dispatched_by_orchestrator=true
#           或 status 尚未变为 in_progress 时，本脚本故意失败。
#           待 headless dispatch 链路完成后自动变绿（GREEN）。
#
# 用法：
#   bash sprints/07191541-relay-565fa27a/tests/contract-red.test.sh
#   BRAIN_URL=http://localhost:5221 bash ... （覆盖默认 URL）
# ============================================================

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://host.docker.internal:5221}"
TASK_ID="565fa27a-4b5b-4eb7-905e-b6fb61eb8413"
TASK_URL="${BRAIN_URL}/api/brain/tasks/${TASK_ID}"

PASS=0
FAIL=0
CONCERN=0

log_pass()    { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
log_fail()    { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }
log_concern() { echo "  [CONCERN] $1"; CONCERN=$((CONCERN + 1)); }

echo "========================================================"
echo " Contract Red Test — headless dispatch smoke 565fa27a"
echo " BRAIN_URL: ${BRAIN_URL}"
echo " TASK_ID:   ${TASK_ID}"
echo " DATE:      $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"
echo ""

# ── 前置：确认 Brain 可达 ──────────────────────────────────
echo "[PRE-CHECK] Brain 连通性..."
if ! curl -sf --max-time 5 "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" > /dev/null 2>&1; then
  echo "  [ERROR] Brain API 不可达: ${TASK_URL}"
  echo "  请确认 Brain 服务运行且 BRAIN_URL 正确。"
  exit 2
fi
echo "  Brain API 可达。"
echo ""

# ── 获取 task 响应（缓存，避免重复请求）─────────────────────
TASK_JSON=$(curl -sf --max-time 10 "${TASK_URL}")
if [ -z "${TASK_JSON}" ]; then
  echo "  [ERROR] API 返回空响应，task 可能不存在: ${TASK_ID}"
  exit 2
fi

echo "[DEBUG] Task 响应摘要（脱敏）："
echo "${TASK_JSON}" | jq '{id: .id, status: .status, dispatched_by_orchestrator: .dispatched_by_orchestrator, payload_keys: (.payload // {} | keys)}' 2>/dev/null || echo "  (jq 解析失败，原始响应非 JSON)"
echo ""

# ── B-01: payload.mode=headless ──────────────────────────
echo "[B-01] payload.mode == headless"
if echo "${TASK_JSON}" | jq -e '.payload.mode=="headless"' > /dev/null 2>&1; then
  log_pass "B-01: payload.mode=headless"
else
  ACTUAL=$(echo "${TASK_JSON}" | jq -r '.payload.mode // "MISSING"' 2>/dev/null)
  log_fail "B-01: payload.mode 期望 headless，实际 ${ACTUAL}"
fi

# ── B-02: payload.executor=claude ────────────────────────
echo "[B-02] payload.executor == claude"
if echo "${TASK_JSON}" | jq -e '.payload.executor=="claude"' > /dev/null 2>&1; then
  log_pass "B-02: payload.executor=claude"
else
  ACTUAL=$(echo "${TASK_JSON}" | jq -r '.payload.executor // "MISSING"' 2>/dev/null)
  log_fail "B-02: payload.executor 期望 claude，实际 ${ACTUAL}"
fi

# ── B-03: payload.orchestrator=skill-relay ───────────────
echo "[B-03] payload.orchestrator == skill-relay"
if echo "${TASK_JSON}" | jq -e '.payload.orchestrator=="skill-relay"' > /dev/null 2>&1; then
  log_pass "B-03: payload.orchestrator=skill-relay"
else
  ACTUAL=$(echo "${TASK_JSON}" | jq -r '.payload.orchestrator // "MISSING"' 2>/dev/null)
  log_fail "B-03: payload.orchestrator 期望 skill-relay，实际 ${ACTUAL}"
fi

# ── B-04: status=in_progress ─────────────────────────────
echo "[B-04] status == in_progress"
if echo "${TASK_JSON}" | jq -e '.status=="in_progress"' > /dev/null 2>&1; then
  log_pass "B-04: status=in_progress"
else
  ACTUAL=$(echo "${TASK_JSON}" | jq -r '.status // "MISSING"' 2>/dev/null)
  log_fail "B-04: status 期望 in_progress，实际 ${ACTUAL}"
fi

# ── B-05: dispatched_by_orchestrator=true ────────────────
echo "[B-05] dispatched_by_orchestrator == true"
if echo "${TASK_JSON}" | jq -e '.dispatched_by_orchestrator==true' > /dev/null 2>&1; then
  log_pass "B-05: dispatched_by_orchestrator=true"
else
  ACTUAL=$(echo "${TASK_JSON}" | jq -r '.dispatched_by_orchestrator // "MISSING"' 2>/dev/null)
  log_fail "B-05: dispatched_by_orchestrator 期望 true，实际 ${ACTUAL}"
fi

# ── B-06: phase-events 记录（可选，concern 级）──────────────
echo "[B-06] phase-events 记录（concern 级，不阻断）"
EVENTS_URL="${BRAIN_URL}/api/brain/harness/phase-events?initiative_id=${TASK_ID}"
EVENTS_RESPONSE=$(curl -sf --max-time 10 "${EVENTS_URL}" 2>/dev/null || echo "[]")
EVENTS_COUNT=$(echo "${EVENTS_RESPONSE}" | jq 'if type=="array" then length else 0 end' 2>/dev/null || echo "0")
if [ "${EVENTS_COUNT}" -ge 1 ]; then
  log_pass "B-06: phase-events 记录数=${EVENTS_COUNT}"
else
  log_concern "B-06: phase-events 暂无 initiative_id=565fa27a 记录（count=${EVENTS_COUNT}）。headless relay 可能尚未触发，不计为 FAIL，但不可声明 headless smoke 成功完成（FR-003）。"
fi

# ── 结果汇总 ─────────────────────────────────────────────
echo ""
echo "========================================================"
echo " 结果汇总"
echo "  PASS:    ${PASS}"
echo "  FAIL:    ${FAIL}"
echo "  CONCERN: ${CONCERN}"
echo "========================================================"

if [ "${FAIL}" -gt 0 ]; then
  echo ""
  echo " 状态：RED — ${FAIL} 个断言未通过"
  echo " 说明：本合同测试初始为 Red 状态（design intent）。"
  echo "       当 Brain headless dispatch 链路完成后，重新执行本脚本应变为 GREEN。"
  echo ""
  exit 1
fi

echo ""
echo " 状态：GREEN — 所有强制断言（B-01~B-05）通过"
if [ "${CONCERN}" -gt 0 ]; then
  echo " 注意：有 ${CONCERN} 个 CONCERN 条目，不阻断通过，但需跟进。"
fi
echo ""
exit 0
