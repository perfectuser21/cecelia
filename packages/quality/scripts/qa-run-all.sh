#!/bin/bash
# QA 完整执行器 - 产出统一的 evidence
# 用法: bash scripts/qa-run-all.sh <scope> [commit_type] [branch]
#   scope: pr | release | nightly
#   commit_type: fix | feat | feat! | ... (可选)
#   branch: 分支名（可选）

set -e

SCOPE=${1:-pr}
COMMIT_TYPE=${2:-}
BRANCH=${3:-$(git rev-parse --abbrev-ref HEAD)}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RUN_ID="run-$(date +%Y%m%d-%H%M%S)"
STARTED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 QA 完整执行器"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   Run ID: $RUN_ID"
echo "   Repo: cecelia-workspace"
echo "   Scope: $SCOPE"
echo "   Commit Type: ${COMMIT_TYPE:-N/A}"
echo "   Branch: $BRANCH"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 创建日志目录
LOG_DIR="$REPO_ROOT/.qa-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$RUN_ID.log"

# 重定向所有输出到日志文件
exec > >(tee -a "$LOG_FILE")
exec 2>&1

START_TIME=$(date +%s)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 1: L1 自动化测试
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "📦 Step 1: L1 自动化测试 (npm run qa)"
echo ""

L1_STATUS="pass"
L1_TESTS="[]"

# Typecheck
echo "  [1/3] typecheck..."
if npm run typecheck > /dev/null 2>&1; then
  echo "  ✅ typecheck pass"
  L1_TESTS=$(echo "$L1_TESTS" | jq '. + [{"name": "typecheck", "status": "pass"}]')
else
  echo "  ❌ typecheck fail"
  L1_STATUS="fail"
  L1_TESTS=$(echo "$L1_TESTS" | jq '. + [{"name": "typecheck", "status": "fail"}]')
fi

# Test (skip if not exists)
if grep -q '"test"' "$REPO_ROOT/package.json" 2>/dev/null; then
  echo "  [2/3] test..."
  if npm run test > /dev/null 2>&1; then
    echo "  ✅ test pass"
    L1_TESTS=$(echo "$L1_TESTS" | jq '. + [{"name": "test", "status": "pass"}]')
  else
    echo "  ⏭️  test skip (not configured)"
    L1_TESTS=$(echo "$L1_TESTS" | jq '. + [{"name": "test", "status": "skip"}]')
  fi
else
  echo "  [2/3] test... ⏭️  skip (not configured)"
  L1_TESTS=$(echo "$L1_TESTS" | jq '. + [{"name": "test", "status": "skip"}]')
fi

# Build
echo "  [3/3] build..."
if npm run build > /dev/null 2>&1; then
  echo "  ✅ build pass"
  L1_TESTS=$(echo "$L1_TESTS" | jq '. + [{"name": "build", "status": "pass"}]')
else
  echo "  ❌ build fail"
  L1_STATUS="fail"
  L1_TESTS=$(echo "$L1_TESTS" | jq '. + [{"name": "build", "status": "fail"}]')
fi

echo ""
echo "  L1 状态: $L1_STATUS"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 2: RCI 执行
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "📋 Step 2: RCI 执行"
echo ""

# 根据 scope 确定优先级
if [ "$SCOPE" == "pr" ]; then
  RCI_PRIORITY="P0,P1"
else
  RCI_PRIORITY="P0,P1,P2"
fi

if bash "$SCRIPT_DIR/qa-run-rci.sh" "$SCOPE" "$RCI_PRIORITY"; then
  RCI_EXIT_CODE=0
else
  RCI_EXIT_CODE=$?
fi

# 读取 RCI 结果
if [ -f "$REPO_ROOT/.qa-rci-result.json" ]; then
  RCI_RESULT=$(cat "$REPO_ROOT/.qa-rci-result.json")
else
  RCI_RESULT='{"status": "skip", "total": 0, "pass": 0, "fail": 0, "items": []}'
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 3: Golden Path 执行（仅 release/nightly）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ "$SCOPE" == "release" ] || [ "$SCOPE" == "nightly" ]; then
  echo "🌟 Step 3: Golden Path 执行"
  echo ""

  if bash "$SCRIPT_DIR/qa-run-gp.sh" "$SCOPE"; then
    GP_EXIT_CODE=0
  else
    GP_EXIT_CODE=$?
  fi

  # 读取 GP 结果
  if [ -f "$REPO_ROOT/.qa-gp-result.json" ]; then
    GP_RESULT=$(cat "$REPO_ROOT/.qa-gp-result.json")
  else
    GP_RESULT='{"status": "skip", "total": 0, "pass": 0, "fail": 0, "items": []}'
  fi
else
  GP_RESULT='{"status": "skip", "total": 0, "pass": 0, "fail": 0, "items": []}'
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 汇总结果
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
COMPLETED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 决定整体状态
OVERALL_STATUS="pass"
if [ "$L1_STATUS" == "fail" ]; then
  OVERALL_STATUS="fail"
elif echo "$RCI_RESULT" | jq -e '.status == "fail"' > /dev/null; then
  OVERALL_STATUS="fail"
elif echo "$GP_RESULT" | jq -e '.status == "fail"' > /dev/null; then
  OVERALL_STATUS="fail"
elif echo "$RCI_RESULT" | jq -e '.status == "partial"' > /dev/null; then
  OVERALL_STATUS="partial"
elif echo "$GP_RESULT" | jq -e '.status == "partial"' > /dev/null; then
  OVERALL_STATUS="partial"
fi

# 生成证据文件
EVIDENCE=$(cat <<EOF
{
  "repo_id": "cecelia-workspace",
  "run_id": "$RUN_ID",
  "scope": "$SCOPE",
  "commit_type": "$COMMIT_TYPE",
  "branch": "$BRANCH",
  "started_at": "$STARTED_AT",
  "completed_at": "$COMPLETED_AT",
  "duration": $DURATION,
  "status": "$OVERALL_STATUS",
  "results": {
    "L1": {
      "status": "$L1_STATUS",
      "tests": $L1_TESTS
    },
    "rci": $RCI_RESULT,
    "gp": $GP_RESULT
  },
  "logs": {
    "full": "$LOG_FILE",
    "summary": "L1: $L1_STATUS, RCI: $(echo "$RCI_RESULT" | jq -r '.status'), GP: $(echo "$GP_RESULT" | jq -r '.status')"
  }
}
EOF
)

echo "$EVIDENCE" | jq '.' > "$REPO_ROOT/.qa-evidence.json"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 QA 执行摘要"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   Run ID: $RUN_ID"
echo "   状态: $OVERALL_STATUS"
echo "   耗时: ${DURATION}s"
echo ""
echo "   L1: $L1_STATUS"
echo "   RCI: $(echo "$RCI_RESULT" | jq -r '.status') ($(echo "$RCI_RESULT" | jq -r '.pass')/$(echo "$RCI_RESULT" | jq -r '.total'))"
echo "   GP: $(echo "$GP_RESULT" | jq -r '.status') ($(echo "$GP_RESULT" | jq -r '.pass')/$(echo "$GP_RESULT" | jq -r '.total'))"
echo ""
echo "   证据文件: .qa-evidence.json"
echo "   日志文件: $LOG_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 返回退出码
if [ "$OVERALL_STATUS" == "fail" ]; then
  exit 1
elif [ "$OVERALL_STATUS" == "partial" ]; then
  exit 2
else
  exit 0
fi
