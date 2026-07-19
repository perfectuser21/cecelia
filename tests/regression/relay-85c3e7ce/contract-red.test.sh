#!/usr/bin/env bash
# contract-red.test.sh — headless-smoke（85c3e7ce）合同测试骨架
# Red 阶段锁定：此文件 commit 后不可改内容（铁律 #5）
# 生成时间: 2026-07-19
# TASK_ID: 85c3e7ce-7849-42b8-9ff9-542dd0db8375
#
# 用途：在代码实现完成前作为 Red 状态测试运行，验证测试确实会失败。
# Green 阶段：由 e2e-verify.sh 驱动真实验收，本文件不改。

set -euo pipefail

TASK_ID="85c3e7ce-7849-42b8-9ff9-542dd0db8375"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07191411-relay-85c3e7ce}"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

pass() { echo "  [PASS] $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "  [FAIL] $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
warn() { echo "  [WARN] $1"; WARN_COUNT=$((WARN_COUNT + 1)); }
section() { echo ""; echo "=== $1 ==="; }

# ────────────────────────────────────────────────────────────────
# [BEHAVIOR-01] Task 状态与三元组校验
# ────────────────────────────────────────────────────────────────
section "BEHAVIOR-01: Task 状态与 headless 三元组"

if ! RESP=$(curl -sf "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null); then
  fail "Brain API 不可达: ${BRAIN_URL}/api/brain/tasks/${TASK_ID}"
else
  # 兼容响应结构：直接字段 or .data 包装
  STATUS=$(echo "$RESP" | jq -r '.status // .data.status // empty')
  MODE=$(echo "$RESP" | jq -r '.payload.mode // .data.payload.mode // empty')
  EXECUTOR=$(echo "$RESP" | jq -r '.payload.executor // .data.payload.executor // empty')
  ORCHESTRATOR=$(echo "$RESP" | jq -r '.payload.orchestrator // .data.payload.orchestrator // empty')
  DISPATCHED=$(echo "$RESP" | jq -r '.dispatched_by_orchestrator // .data.dispatched_by_orchestrator // empty')
  DISPATCHED_AT=$(echo "$RESP" | jq -r '.orchestrator_dispatched_at // .data.orchestrator_dispatched_at // empty')

  # 铁律 #2：必须引用实时 API 响应，不接受历史缓存
  [ "$STATUS" = "in_progress" ] && pass "status=in_progress" || fail "status expected in_progress, got: $STATUS"
  [ "$MODE" = "headless" ] && pass "payload.mode=headless" || fail "payload.mode expected headless, got: $MODE"
  [ "$EXECUTOR" = "claude" ] && pass "payload.executor=claude" || fail "payload.executor expected claude, got: $EXECUTOR"
  [ "$ORCHESTRATOR" = "skill-relay" ] && pass "payload.orchestrator=skill-relay" || fail "payload.orchestrator expected skill-relay, got: $ORCHESTRATOR"
  [ "$DISPATCHED" = "true" ] && pass "dispatched_by_orchestrator=true" || fail "dispatched_by_orchestrator expected true, got: $DISPATCHED"
  if [ -n "$DISPATCHED_AT" ] && [ "$DISPATCHED_AT" != "null" ]; then
    pass "orchestrator_dispatched_at is set"
  else
    fail "orchestrator_dispatched_at is empty or null"
  fi
fi

# ────────────────────────────────────────────────────────────────
# [BEHAVIOR-02] Claim Oracle 验证
# ────────────────────────────────────────────────────────────────
section "BEHAVIOR-02: Claim Oracle"

if RESP=$(curl -sf "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null); then
  CLAIMED_BY=$(echo "$RESP" | jq -r '.claimed_by // .data.claimed_by // empty')
  CLAIMED_AT=$(echo "$RESP" | jq -r '.claimed_at // .data.claimed_at // empty')
  EXECUTOR_KIND=$(echo "$RESP" | jq -r '.executor_kind // .data.executor_kind // empty')

  if [ -n "$CLAIMED_BY" ] && [ "$CLAIMED_BY" != "null" ]; then
    pass "claimed_by is set: $CLAIMED_BY"
  else
    fail "claimed_by is empty or null"
  fi

  if [ -n "$CLAIMED_AT" ] && [ "$CLAIMED_AT" != "null" ]; then
    pass "claimed_at is set"
  else
    fail "claimed_at is empty or null"
  fi

  if [ -n "$EXECUTOR_KIND" ] && [ "$EXECUTOR_KIND" != "null" ]; then
    pass "executor_kind is set: $EXECUTOR_KIND"
  else
    fail "executor_kind is empty or null"
  fi
else
  fail "Brain API not reachable for claim oracle check"
fi

# ────────────────────────────────────────────────────────────────
# [BEHAVIOR-03] initiative_runs Concern 记录
# ────────────────────────────────────────────────────────────────
section "BEHAVIOR-03: initiative_runs Concern"

HTTP_CODE=$(curl -s -o /tmp/relay_runs_resp_85c3e7ce.json \
  -w "%{http_code}" \
  "${BRAIN_URL}/api/brain/relay-runs?task_id=${TASK_ID}" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "000" ]; then
  warn "Brain API not reachable for relay-runs check"
elif [ "$HTTP_CODE" = "404" ]; then
  # 铁律 #3：端点不存在必须记录为 concern，不是失败
  echo "CONCERN [$(date -u +%Y-%m-%dT%H:%M:%SZ)]: relay-runs endpoint returned 404 for task ${TASK_ID}" \
    >> "${SPRINT_DIR}/concerns.txt" 2>/dev/null || true
  warn "relay-runs 端点不存在 (404)，已记录 concern（非失败）"
  pass "initiative_runs concern recorded (not a failure per spec)"
else
  COUNT=$(jq 'if type=="array" then length elif .data and (.data|type=="array") then (.data|length) else 0 end' \
    /tmp/relay_runs_resp_85c3e7ce.json 2>/dev/null || echo 0)
  if [ "$COUNT" -eq 0 ]; then
    echo "CONCERN [$(date -u +%Y-%m-%dT%H:%M:%SZ)]: initiative_runs empty for task ${TASK_ID} (HTTP ${HTTP_CODE})" \
      >> "${SPRINT_DIR}/concerns.txt" 2>/dev/null || true
    warn "initiative_runs 为空（HTTP ${HTTP_CODE}），已记录 concern（非失败）"
    pass "initiative_runs empty concern recorded (not a failure per spec)"
  else
    pass "initiative_runs count=${COUNT}"
  fi
fi

# ────────────────────────────────────────────────────────────────
# [BEHAVIOR-04] 证据文件写入
# ────────────────────────────────────────────────────────────────
section "BEHAVIOR-04: 证据文件写入"

if RESP=$(curl -sf "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null); then
  # 脱敏摘要：只取必要字段，不含 secrets
  EVIDENCE=$(echo "$RESP" | jq '{
    task_id: (.id // .data.id // "85c3e7ce-7849-42b8-9ff9-542dd0db8375"),
    status: (.status // .data.status),
    payload: (.payload // .data.payload),
    orchestrator_dispatched_at: (.orchestrator_dispatched_at // .data.orchestrator_dispatched_at),
    claimed_at: (.claimed_at // .data.claimed_at),
    executor_kind: (.executor_kind // .data.executor_kind),
    claimed_by: (.claimed_by // .data.claimed_by),
    evidence_captured_at: "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
  }')

  echo "$EVIDENCE" > "${SPRINT_DIR}/evidence.json"
  pass "evidence.json written to ${SPRINT_DIR}/evidence.json"

  # 验证 task_id 在文件中
  TIDCHECK=$(jq -r '.task_id // empty' "${SPRINT_DIR}/evidence.json")
  [ -n "$TIDCHECK" ] && pass "evidence.json contains task_id" || fail "evidence.json missing task_id"
else
  fail "Cannot write evidence.json: Brain API not reachable"
fi

# ────────────────────────────────────────────────────────────────
# [BEHAVIOR-05] e2e-verify.sh 脚本存在性检查（Red 阶段：文件可能不存在）
# ────────────────────────────────────────────────────────────────
section "BEHAVIOR-05: e2e-verify.sh 存在性"

E2E_SCRIPT="${SPRINT_DIR}/e2e-verify.sh"
if [ -f "$E2E_SCRIPT" ]; then
  pass "e2e-verify.sh exists"
  [ -x "$E2E_SCRIPT" ] && pass "e2e-verify.sh is executable" || fail "e2e-verify.sh is not executable"
  # 检查无兜底 exit 0
  if grep -n '^exit 0' "$E2E_SCRIPT" | grep -v '^#' > /dev/null 2>&1; then
    fail "e2e-verify.sh contains bare 'exit 0' backdoor"
  else
    pass "no bare 'exit 0' backdoor in e2e-verify.sh"
  fi
else
  fail "e2e-verify.sh does not exist yet (Red state — expected before implementation)"
fi

# ────────────────────────────────────────────────────────────────
# [BEHAVIOR-06] headless 路径独立性
# ────────────────────────────────────────────────────────────────
section "BEHAVIOR-06: headless 路径独立性"

E2E_SCRIPT="${SPRINT_DIR}/e2e-verify.sh"
if [ -f "$E2E_SCRIPT" ]; then
  # 铁律 #1：不得引用 headed session 历史
  if grep -qiE 'd355821f|headed.*session|headed.*history|headed.*evidence' "$E2E_SCRIPT" 2>/dev/null; then
    fail "e2e-verify.sh references headed session artifacts — violates iron rule #1"
  else
    pass "no headed session dependency in e2e-verify.sh"
  fi

  # 必须包含对当前 task_id 的 curl 调用
  if grep -q "85c3e7ce" "$E2E_SCRIPT" && grep -q 'curl' "$E2E_SCRIPT"; then
    pass "e2e-verify.sh contains curl with correct task_id"
  else
    fail "e2e-verify.sh missing curl call with task_id 85c3e7ce"
  fi
else
  warn "e2e-verify.sh not yet created — independence check deferred (Red state)"
fi

# ────────────────────────────────────────────────────────────────
# 汇总
# ────────────────────────────────────────────────────────────────
echo ""
echo "=================================================="
echo "  合同测试骨架 (Red State) 结果汇总"
echo "  TASK_ID: ${TASK_ID}"
echo "  PASS:  ${PASS_COUNT}"
echo "  FAIL:  ${FAIL_COUNT}"
echo "  WARN:  ${WARN_COUNT}"
echo "=================================================="

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo ""
  echo "Red 状态：${FAIL_COUNT} 个断言失败，符合预期（等待实现）"
  echo "或：实现完成但存在真实问题，需修复。"
  exit 1
else
  echo ""
  echo "所有断言通过（Green 状态）"
  exit 0
fi
