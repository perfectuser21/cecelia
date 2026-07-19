#!/usr/bin/env bash
# contract-red.test.sh — Red 验证脚本（B-1 至 B-8）
# 对应 contract-dod.md 中的 [BEHAVIOR] 条目
# 在 GREEN 实现完成之前，B-6/B-7/B-8 预期失败

TASK_ID="dedbca0c-0864-4b0d-be69-d37f70a25827"
BRAIN="${BRAIN_URL:-http://localhost:5221}"

PASS=0
FAIL=0
CONCERN=0

check() {
  local b="$1"
  local desc="$2"
  local cmd="$3"
  local optional="${4:-false}"

  echo ""
  echo "--- $b: $desc ---"
  if eval "$cmd" > /dev/null 2>&1; then
    echo "PASS $b"
    PASS=$((PASS+1))
  else
    if [ "$optional" = "true" ]; then
      echo "CONCERN $b (expected FAIL at Red stage — will pass after Green)"
      CONCERN=$((CONCERN+1))
    else
      echo "FAIL $b"
      FAIL=$((FAIL+1))
    fi
  fi
}

echo "===== contract-red.test.sh ====="
echo "TASK_ID: $TASK_ID"
echo "BRAIN:   $BRAIN"
echo ""

# B-1: task status in_progress 或 completed
check "B-1" \
  "task status 在 harness 接管后为 in_progress 或 completed" \
  "curl -sf \"$BRAIN/api/brain/tasks/$TASK_ID\" | jq -e '.status == \"in_progress\" or .status == \"completed\"'"

# B-2: payload 含 headless dispatch 三元组
check "B-2" \
  "task payload 包含 headless dispatch 三元组" \
  "curl -sf \"$BRAIN/api/brain/tasks/$TASK_ID\" | jq -e '.payload.mode == \"headless\" and .payload.orchestrator == \"skill-relay\" and .payload.dispatched_by_orchestrator == true'"

# B-3: status_history 存在 queued → in_progress
check "B-3" \
  "status_history 存在 queued → in_progress 转换" \
  "curl -sf \"$BRAIN/api/brain/tasks/$TASK_ID\" | jq -e '[.status_history[] | select(.from == \"queued\" and .to == \"in_progress\")] | length > 0'"

# B-4: claimed_by 非空且 claimed_at 有时间戳
check "B-4" \
  "claimed_by 非空且 claimed_at 有时间戳" \
  "curl -sf \"$BRAIN/api/brain/tasks/$TASK_ID\" | jq -e '.claimed_by != null and .claimed_at != null'"

# B-5: sprint 目录产物存在（在 proposer 阶段即应通过）
SPRINT_DIR="${SPRINT_DIR:-sprints/07191539-relay-dedbca0c}"
check "B-5" \
  "sprint 目录产物存在（sprint-prd.md + contract-draft.md + contract-dod.md）" \
  "test -f \"$SPRINT_DIR/sprint-prd.md\" && test -f \"$SPRINT_DIR/contract-draft.md\" && test -f \"$SPRINT_DIR/contract-dod.md\""

# B-6: harness run 记录存在（Green 阶段才通过）
check "B-6" \
  "harness run 记录在 Brain DB 存在" \
  "curl -sf \"$BRAIN/api/brain/harness/runs\" | jq -e --arg tid \"$TASK_ID\" '[.[] | select(.initiative_id == \$tid)] | length > 0'" \
  "true"

# B-7: started_at 不为 null（Green 阶段才通过）
check "B-7" \
  "started_at 不为 null" \
  "curl -sf \"$BRAIN/api/brain/tasks/$TASK_ID\" | jq -e '.started_at != null'" \
  "true"

# B-8: 完成态（Green 阶段最后才通过）
check "B-8" \
  "（完成态）task status=completed 且 pr_url 非 null" \
  "curl -sf \"$BRAIN/api/brain/tasks/$TASK_ID\" | jq -e '.status == \"completed\" and .pr_url != null'" \
  "true"

echo ""
echo "===== 汇总 ====="
echo "PASS:    $PASS"
echo "FAIL:    $FAIL"
echo "CONCERN: $CONCERN (Red 阶段预期失败，Green 完成后应转 PASS)"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "RED 阶段核心断言失败 ($FAIL 项) — 需修复"
  exit 1
else
  echo "Red 阶段核心断言 ($PASS 项 PASS) — 可进入 Green 实现"
  exit 0
fi
