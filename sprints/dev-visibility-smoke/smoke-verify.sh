#!/usr/bin/env bash
# smoke-verify.sh — 端到端验证 buildGeneratorPrompt PRD 注入行为
set -euo pipefail

PASS=0
FAIL=0

check() {
  local label="$1"
  local result="$2"
  if [ "$result" = "OK" ]; then
    echo "[PASS] $label"
    PASS=$((PASS + 1))
  else
    echo "[FAIL] $label"
    FAIL=$((FAIL + 1))
  fi
}

# 1. sprint-prd.md 存在性检查
if [ -s "sprints/dev-visibility-smoke/sprint-prd.md" ]; then
  check "sprint-prd.md 存在且非空" "OK"
else
  check "sprint-prd.md 存在且非空" "FAIL"
fi

# 2. harness-utils.js 含 ## Sprint PRD 注入代码检查
HARNESS_UTILS="packages/brain/src/harness-utils.js"
if grep -q "Sprint PRD" "$HARNESS_UTILS"; then
  check "harness-utils.js 含 'Sprint PRD' 关键词" "OK"
else
  check "harness-utils.js 含 'Sprint PRD' 关键词" "FAIL"
fi

# 3. harness-utils.js 含 prdContent 关键词（独立检查）
if grep -q "prdContent" "$HARNESS_UTILS"; then
  check "harness-utils 含 prdContent 关键词" "OK"
else
  check "harness-utils 含 prdContent 关键词" "FAIL"
fi

# 4. harness-initiative.graph.js 含 sprint-prd.md 读取 + prdContent 传递（独立检查）
GRAPH_JS="packages/brain/src/workflows/harness-initiative.graph.js"
if grep -q "sprint-prd.md" "$GRAPH_JS" && grep -q "prdContent" "$GRAPH_JS"; then
  check "harness-initiative.graph.js 含 sprint-prd.md 读取 + prdContent 传递" "OK"
else
  check "harness-initiative.graph.js 含 sprint-prd.md 读取 + prdContent 传递" "FAIL"
fi

# 5. Brain tasks 验证（GET /api/brain/tasks/$TASK_ID）
if curl -sf localhost:5221/api/brain/health > /dev/null 2>&1; then
  TASK_ID="${TASK_ID:-}"
  if [ -z "$TASK_ID" ]; then
    echo "[SKIP] TASK_ID 未设置，跳过 Brain tasks 验证"
  else
    RESP=$(curl -sf "localhost:5221/api/brain/tasks/${TASK_ID}" 2>/dev/null) || {
      check "Brain tasks/$TASK_ID 可达" "FAIL"
      RESP=""
    }
    if [ -n "$RESP" ]; then
      STATUS=$(echo "$RESP" | jq -r '.status // "unknown"')
      if echo "$RESP" | jq -e '.status == "completed" or .status == "in_progress"' > /dev/null 2>&1; then
        check "Brain tasks/$TASK_ID status=$STATUS" "OK"
      else
        check "Brain tasks/$TASK_ID status=$STATUS（期望 completed 或 in_progress）" "FAIL"
      fi
    fi
  fi
else
  echo "[SKIP] Brain 不在线，跳过 tasks 验证"
fi

# 结果
echo ""
echo "结果: $PASS PASS / $FAIL FAIL"
[ "$FAIL" -eq 0 ] || exit 1
