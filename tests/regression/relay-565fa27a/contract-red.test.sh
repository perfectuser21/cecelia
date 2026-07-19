#!/usr/bin/env bash
# ============================================================
# contract-red.test.sh — headless dispatch smoke regression 565fa27a
# Task ID: 565fa27a-4b5b-4eb7-905e-b6fb61eb8413
# Sprint: 07191541-relay-565fa27a
# Wrapper: scripts/smoke/e2e/relay-565fa27a.sh
#
# 初始状态：RED（设计意图）
# 本回归测试在 Brain headless dispatch 链路完成前故意失败。
# 完成后每次 CI 均重跑（regression test，不可删除）。
#
# 用法:
#   bash tests/regression/relay-565fa27a/contract-red.test.sh
#   BRAIN_URL=http://localhost:5221 DATABASE_URL=... bash ...
#
# 覆盖 [BEHAVIOR] 条目:
#   B1: task API payload shape (mode=headless/executor=claude/orchestrator=skill-relay/smoke_test=true/dispatched_by_orchestrator=true)
#   B2: task status=in_progress (headless dispatch claim oracle)
#   B3: initiative_runs 缺 run 时只输出 concern，不判定成功
#   B4: 拒绝历史 task d355821f 作为当前成功证据
#   B5: 证据边界：只在 sprints/07191541-relay-565fa27a/，脱敏
#   B6: L3 真验才 done：wrapper 真实 curl Brain API + psql DB，禁止 mock/exit0
#
# wrapper assert 名称（供 ARTIFACT 字符串检测）:
#   task-payload-shape
#   db-dispatch-oracle
#   runs-concern-or-verified
#   current-task-only
#   evidence-boundary-and-redaction
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

SPRINT_DIR="${SPRINT_DIR:-sprints/07191541-relay-565fa27a}"
TASK_ID="${TASK_ID:-565fa27a-4b5b-4eb7-905e-b6fb61eb8413}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DATABASE_URL="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
VERIFY="${VERIFY:-scripts/smoke/e2e/relay-565fa27a.sh}"

PASS=0
FAIL=0
CONCERN=0

log_pass()    { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
log_fail()    { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }
log_concern() { echo "  [CONCERN] $1"; CONCERN=$((CONCERN + 1)); }

echo "========================================================"
echo " Contract Red Test — headless dispatch smoke 565fa27a"
echo " TASK_ID:    ${TASK_ID}"
echo " BRAIN_URL:  ${BRAIN_URL}"
echo " SPRINT_DIR: ${SPRINT_DIR}"
echo " VERIFY:     ${VERIFY}"
echo " DATE:       $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"
echo ""

# ── [ARTIFACT] wrapper 文件存在 ───────────────────────────
echo "[ARTIFACT] wrapper 文件存在: ${VERIFY}"
if [ -f "$VERIFY" ]; then
  log_pass "ARTIFACT: ${VERIFY} 存在"
else
  log_fail "ARTIFACT: ${VERIFY} 不存在"
fi

# ── [ARTIFACT] wrapper bash 语法正确 ──────────────────────
echo "[ARTIFACT] wrapper bash 语法正确"
if [ -f "$VERIFY" ] && bash -n "$VERIFY" 2>/dev/null; then
  log_pass "ARTIFACT: bash -n ${VERIFY} 通过"
else
  log_fail "ARTIFACT: ${VERIFY} bash 语法错误或文件不存在"
fi

# ── [B6] L3 真验才 done: wrapper 含真实 curl + psql ───────
echo "[B6] L3 真验才 done: wrapper 含真实 curl 和 psql"
if [ -f "$VERIFY" ]; then
  MISSING_CALLS=""
  grep -F "curl -sf" "$VERIFY" >/dev/null 2>&1 || MISSING_CALLS="${MISSING_CALLS} curl-sf"
  grep -F "psql" "$VERIFY" >/dev/null 2>&1 || MISSING_CALLS="${MISSING_CALLS} psql"
  if [ -z "$MISSING_CALLS" ]; then
    log_pass "B6: wrapper 含真实 curl-sf + psql"
  else
    log_fail "B6: wrapper 缺少真实调用: ${MISSING_CALLS}"
  fi
  # 禁止 mock/stub/exit0
  if grep -E "MOCK_|force_|\\|\\|[[:space:]]*true|exit[[:space:]]+0[[:space:]]*(#.*)?$" "$VERIFY" >/dev/null 2>&1; then
    log_fail "B6: wrapper 含 mock/stub/无条件 exit0"
  else
    log_pass "B6: wrapper 无 mock/stub/无条件 exit0"
  fi
else
  log_fail "B6: wrapper 文件不存在，无法检查 L3 要求"
fi

# ── [B4] 拒绝历史 task 作为当前证据 ──────────────────────
echo "[B4] 拒绝历史 task d355821f 作为当前 TASK_ID"
if [ "$TASK_ID" = "565fa27a-4b5b-4eb7-905e-b6fb61eb8413" ]; then
  log_pass "B4: TASK_ID 绑定当前 task"
else
  log_fail "B4: TASK_ID=${TASK_ID} 不是当前 task"
fi

# ── [B5] 证据边界: SPRINT_DIR 正确 ────────────────────────
echo "[B5] 证据边界: SPRINT_DIR 正确"
case "$SPRINT_DIR" in
  sprints/07191541-relay-565fa27a|*/sprints/07191541-relay-565fa27a)
    log_pass "B5: SPRINT_DIR=${SPRINT_DIR} 绑定当前 sprint"
    ;;
  *)
    log_fail "B5: SPRINT_DIR=${SPRINT_DIR} 不是当前 sprint"
    ;;
esac

# ── [B1/B2] task payload shape + status（真实 Brain API）──
echo "[B1/B2] task API: payload shape + status=in_progress"
if ! curl -sf --max-time 5 "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" > /dev/null 2>&1; then
  log_fail "B1/B2: Brain API 不可达: ${BRAIN_URL}/api/brain/tasks/${TASK_ID}"
else
  TASK_JSON=$(curl -sf --max-time 10 "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null || echo "")
  if [ -z "$TASK_JSON" ]; then
    log_fail "B1/B2: Brain API 返回空响应"
  else
    # B1: payload shape
    if echo "$TASK_JSON" | jq -e '.payload.mode=="headless" and .payload.executor=="claude" and .payload.orchestrator=="skill-relay" and .payload.smoke_test==true and .payload.dispatched_by_orchestrator==true' >/dev/null 2>&1; then
      log_pass "B1: task payload shape 匹配 (mode=headless/executor=claude/orchestrator=skill-relay/smoke_test=true/dispatched_by_orchestrator=true)"
    else
      ACTUAL=$(echo "$TASK_JSON" | jq '{mode:.payload.mode,executor:.payload.executor,orchestrator:.payload.orchestrator,smoke_test:.payload.smoke_test,dispatched:.payload.dispatched_by_orchestrator}' 2>/dev/null || echo "parse_error")
      log_fail "B1: task payload shape 不匹配，实际: ${ACTUAL}"
    fi
    # B2: status=in_progress
    if echo "$TASK_JSON" | jq -e '.status=="in_progress"' >/dev/null 2>&1; then
      log_pass "B2: task status=in_progress (headless dispatch claim oracle)"
    else
      ACTUAL=$(echo "$TASK_JSON" | jq -r '.status // "MISSING"' 2>/dev/null)
      log_fail "B2: status 期望 in_progress，实际 ${ACTUAL}"
    fi
    # 禁用字段检查
    if echo "$TASK_JSON" | jq -e '(.payload | has("token") | not) and (.payload | has("github_token") | not) and (.payload | has("anthropic_token") | not) and (.payload | has("thin_prd") | not) and (.payload | has("prep_prd_body") | not)' >/dev/null 2>&1; then
      log_pass "B1: payload 不含禁用字段"
    else
      log_fail "B1: payload 含禁用字段 (token/github_token/anthropic_token/thin_prd/prep_prd_body)"
    fi
  fi
fi

# ── [B3] initiative_runs 缺当前 task run 时只输出 concern ─
echo "[B3] initiative_runs: 缺 run 只输出 concern，不判定成功"
if [ -f "$VERIFY" ]; then
  # 执行 --assert runs-concern-or-verified，检查 concern 路径
  SET_ENV="TASK_ID=\"$TASK_ID\" BRAIN_URL=\"$BRAIN_URL\" DATABASE_URL=\"$DATABASE_URL\" SPRINT_DIR=\"$SPRINT_DIR\""
  RUN_OUT=$(eval "${SET_ENV} bash \"$VERIFY\" --assert runs-concern-or-verified 2>&1") || RUN_EXIT=$?
  RUN_EXIT="${RUN_EXIT:-0}"
  if [ "$RUN_EXIT" = "0" ]; then
    if echo "$RUN_OUT" | grep -q "CONCERN"; then
      log_concern "B3: initiative_runs 缺当前 task run，已正确输出 CONCERN（不判定失败，符合 FR-003）"
    else
      log_pass "B3: initiative_runs 当前 task run 存在且通过验证"
    fi
  else
    log_fail "B3: runs-concern-or-verified 返回非 0 exit (exit=${RUN_EXIT})，输出: ${RUN_OUT}"
  fi
else
  log_concern "B3: wrapper 不存在，跳过 initiative_runs 检查"
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
  echo " 说明：本合同测试设计为初始 Red 状态（TDD 精神）。"
  echo "       当 Brain headless dispatch 链路满足所有断言后，重新执行应变为 GREEN。"
  echo ""
  exit 1
fi

echo ""
echo " 状态：GREEN — 所有强制断言通过"
if [ "${CONCERN}" -gt 0 ]; then
  echo " 注意：有 ${CONCERN} 个 CONCERN 条目，不阻断通过，但需跟进。"
fi
echo ""
exit 0
