#!/usr/bin/env bash
# e2e-verify.sh — headless-smoke（85c3e7ce）E2E 验收脚本
# 铁律 #4：禁止 exit 0 兜底；每个断言失败即 exit 1
# 铁律 #1：所有断言基于实时 Brain API，不依赖 headed session 历史
# 铁律 #2：所有 done 判定引用 task_id 85c3e7ce-7849-42b8-9ff9-542dd0db8375 的实时响应
# 幂等：可重复执行

set -uo pipefail

TASK_ID="85c3e7ce-7849-42b8-9ff9-542dd0db8375"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
SPRINT_DIR="${SPRINT_DIR:-sprints/07191411-relay-85c3e7ce}"

echo "=== E2E 验收：headless-smoke (${TASK_ID}) ==="
echo "Brain URL: ${BRAIN_URL}"
echo "Sprint Dir: ${SPRINT_DIR}"
echo ""

# 工具检查
if ! command -v jq &>/dev/null; then
  echo "[FATAL] jq 未安装，无法执行字段校验" >&2
  exit 1
fi
if ! command -v curl &>/dev/null; then
  echo "[FATAL] curl 未安装" >&2
  exit 1
fi

# ── 获取 Task API 响应 ──────────────────────────────────────────
echo "--- 获取实时 Task 状态 ---"
if ! RESP=$(curl -sf "${BRAIN_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null); then
  echo "[FAIL] Brain API 不可达: ${BRAIN_URL}/api/brain/tasks/${TASK_ID}" >&2
  exit 1
fi

echo "API 响应（脱敏）: $(echo "$RESP" | jq '{status, executor_kind, claimed_by, orchestrator_dispatched_at}' 2>/dev/null || echo "$RESP" | head -c 200)"
echo ""

# ── FR-01: Task 状态与三元组 ────────────────────────────────────
echo "--- FR-01: Task 状态与 headless 三元组 ---"

STATUS=$(echo "$RESP" | jq -r '.status // .data.status // empty')
MODE=$(echo "$RESP" | jq -r '.payload.mode // .data.payload.mode // empty')
EXECUTOR=$(echo "$RESP" | jq -r '.payload.executor // .data.payload.executor // empty')
ORCHESTRATOR=$(echo "$RESP" | jq -r '.payload.orchestrator // .data.payload.orchestrator // empty')
DISPATCHED=$(echo "$RESP" | jq -r '.dispatched_by_orchestrator // .data.dispatched_by_orchestrator // empty')
DISPATCHED_AT=$(echo "$RESP" | jq -r '.orchestrator_dispatched_at // .data.orchestrator_dispatched_at // empty')

if [ "$STATUS" != "in_progress" ]; then
  echo "[FAIL] status 期望 in_progress，实际: $STATUS" >&2
  exit 1
fi
echo "[PASS] status=in_progress"

if [ "$MODE" != "headless" ]; then
  echo "[FAIL] payload.mode 期望 headless，实际: $MODE" >&2
  exit 1
fi
echo "[PASS] payload.mode=headless"

if [ "$EXECUTOR" != "claude" ]; then
  echo "[FAIL] payload.executor 期望 claude，实际: $EXECUTOR" >&2
  exit 1
fi
echo "[PASS] payload.executor=claude"

if [ "$ORCHESTRATOR" != "skill-relay" ]; then
  echo "[FAIL] payload.orchestrator 期望 skill-relay，实际: $ORCHESTRATOR" >&2
  exit 1
fi
echo "[PASS] payload.orchestrator=skill-relay"

if [ "$DISPATCHED" != "true" ]; then
  echo "[FAIL] dispatched_by_orchestrator 期望 true，实际: $DISPATCHED" >&2
  exit 1
fi
echo "[PASS] dispatched_by_orchestrator=true"

if [ -z "$DISPATCHED_AT" ] || [ "$DISPATCHED_AT" = "null" ]; then
  echo "[FAIL] orchestrator_dispatched_at 为空或 null" >&2
  exit 1
fi
echo "[PASS] orchestrator_dispatched_at=$DISPATCHED_AT"

echo ""

# ── FR-02: Claim Oracle ─────────────────────────────────────────
echo "--- FR-02: Claim Oracle ---"

CLAIMED_BY=$(echo "$RESP" | jq -r '.claimed_by // .data.claimed_by // empty')
CLAIMED_AT=$(echo "$RESP" | jq -r '.claimed_at // .data.claimed_at // empty')
EXECUTOR_KIND=$(echo "$RESP" | jq -r '.executor_kind // .data.executor_kind // empty')

if [ -z "$CLAIMED_BY" ] || [ "$CLAIMED_BY" = "null" ]; then
  echo "[FAIL] claimed_by 为空或 null" >&2
  exit 1
fi
echo "[PASS] claimed_by=$CLAIMED_BY"

if [ -z "$CLAIMED_AT" ] || [ "$CLAIMED_AT" = "null" ]; then
  echo "[FAIL] claimed_at 为空或 null" >&2
  exit 1
fi
echo "[PASS] claimed_at=$CLAIMED_AT"

if [ -z "$EXECUTOR_KIND" ] || [ "$EXECUTOR_KIND" = "null" ]; then
  echo "[FAIL] executor_kind 为空或 null" >&2
  exit 1
fi
echo "[PASS] executor_kind=$EXECUTOR_KIND"

echo ""

# ── FR-03: initiative_runs Concern ─────────────────────────────
echo "--- FR-03: initiative_runs 检查 ---"

HTTP_CODE=$(curl -s -o /tmp/relay_runs_resp_e2e_85c3e7ce.json \
  -w "%{http_code}" \
  "${BRAIN_URL}/api/brain/relay-runs?task_id=${TASK_ID}" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "000" ]; then
  echo "[WARN] relay-runs 端点无法连接，记录 concern"
  echo "CONCERN [$(date -u +%Y-%m-%dT%H:%M:%SZ)]: relay-runs endpoint unreachable for task ${TASK_ID}" \
    >> "${SPRINT_DIR}/concerns.txt" 2>/dev/null || true
elif [ "$HTTP_CODE" = "404" ]; then
  # 铁律 #3：404 记录 concern，不是失败
  echo "CONCERN [$(date -u +%Y-%m-%dT%H:%M:%SZ)]: relay-runs endpoint 404 for task ${TASK_ID}" \
    >> "${SPRINT_DIR}/concerns.txt" 2>/dev/null || true
  echo "[CONCERN] relay-runs 端点不存在 (404)，已记录 concern（不记为失败）"
else
  RUN_COUNT=$(jq 'if type=="array" then length elif .data and (.data|type=="array") then (.data|length) else 0 end' \
    /tmp/relay_runs_resp_e2e_85c3e7ce.json 2>/dev/null || echo 0)
  if [ "$RUN_COUNT" -eq 0 ]; then
    echo "CONCERN [$(date -u +%Y-%m-%dT%H:%M:%SZ)]: initiative_runs empty for task ${TASK_ID} (HTTP ${HTTP_CODE})" \
      >> "${SPRINT_DIR}/concerns.txt" 2>/dev/null || true
    echo "[CONCERN] initiative_runs 为空，已记录 concern（不记为失败）"
  else
    echo "[PASS] initiative_runs count=${RUN_COUNT}"
  fi
fi

echo ""

# ── FR-04: 写入 evidence.json ───────────────────────────────────
echo "--- FR-04: 证据写入 ---"

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

if ! echo "$EVIDENCE" > "${SPRINT_DIR}/evidence.json"; then
  echo "[FAIL] 无法写入 evidence.json" >&2
  exit 1
fi

TIDCHECK=$(jq -r '.task_id // empty' "${SPRINT_DIR}/evidence.json" 2>/dev/null)
if [ -z "$TIDCHECK" ]; then
  echo "[FAIL] evidence.json 写入后 task_id 为空" >&2
  exit 1
fi
echo "[PASS] evidence.json 已写入 ${SPRINT_DIR}/evidence.json (task_id=${TIDCHECK})"

echo ""

# ── 汇总 ────────────────────────────────────────────────────────
echo "=================================================="
echo "  E2E 验收完成"
echo "  TASK_ID: ${TASK_ID}"
echo "  所有 FR 通过（FR-03 concern 不阻断）"
echo "=================================================="

# 铁律 #4：此处 exit 0 是真实通过后的正常结束，非兜底
# 以上每个 [FAIL] 都已 exit 1，到达此行说明全部通过
exit 0
