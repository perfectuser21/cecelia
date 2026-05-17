#!/usr/bin/env bash
# ============================================================================
# QA with Quality Gate
# ============================================================================
# 运行完整质检，成功时生成质检门控文件
# ============================================================================

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
QUALITY_GATE_FILE="$PROJECT_ROOT/.quality-gate-passed"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  QA 质检开始"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 删除旧的质检门控文件
rm -f "$QUALITY_GATE_FILE"

# 运行质检
echo "  [1/3] Typecheck..."
npm run typecheck || {
    echo ""
    echo "❌ Typecheck 失败"
    exit 1
}

echo ""
echo "  [2/3] Test..."
npm run test || {
    echo ""
    echo "❌ 测试失败"
    exit 1
}

echo ""
echo "  [3/3] Build..."
npm run build || {
    echo ""
    echo "❌ 构建失败"
    exit 1
}

# 全部通过，生成质检门控文件
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ QA 质检全部通过！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 生成质检门控文件（带时间戳）
cat > "$QUALITY_GATE_FILE" << EOF
# Quality Gate Passed
# Generated: $(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S')
# Branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
# Commit: $(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

typecheck: PASS
test: PASS
build: PASS
EOF

echo "  质检门控文件已生成: .quality-gate-passed"
echo ""

# ============================================================================
# P0-2: Evidence Gate - 生成质检证据 JSON
# ============================================================================
EVIDENCE_FILE="$PROJECT_ROOT/.quality-evidence.json"
CURRENT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
TIMESTAMP=$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S')

# 获取 Audit Decision（如果存在）
AUDIT_DECISION="UNKNOWN"
if [[ -f "$PROJECT_ROOT/docs/AUDIT-REPORT.md" ]]; then
  # 只提取第一个 Decision 行，防止多行匹配
  AUDIT_DECISION=$(grep "^Decision:" "$PROJECT_ROOT/docs/AUDIT-REPORT.md" | head -1 | awk '{print $2}' || echo "UNKNOWN")
fi

# 获取测试统计（从最近的测试输出）
TEST_STATS="passed"

# 获取 Audit 问题统计（如果存在 AUDIT-REPORT.md）
AUDIT_L1=0
AUDIT_L2=0
if [[ -f "$PROJECT_ROOT/docs/AUDIT-REPORT.md" ]]; then
  # 只提取 Summary 块中的 L1/L2，防止提取到其他部分
  AUDIT_L1=$(sed -n '/^Summary:/,/^Decision:/p' "$PROJECT_ROOT/docs/AUDIT-REPORT.md" | grep "^\s*L1:" | awk '{print $2}' || echo "0")
  AUDIT_L2=$(sed -n '/^Summary:/,/^Decision:/p' "$PROJECT_ROOT/docs/AUDIT-REPORT.md" | grep "^\s*L2:" | awk '{print $2}' || echo "0")
fi

# 生成 JSON 证据文件（使用 jq 确保格式正确）
if ! command -v jq &> /dev/null; then
  echo "❌ jq 未安装，无法生成质检证据"
  echo "   请安装: sudo apt-get install jq (Ubuntu) 或 brew install jq (macOS)"
  exit 1
fi

jq -n \
  --arg sha "$CURRENT_SHA" \
  --arg branch "$CURRENT_BRANCH" \
  --arg timestamp "$TIMESTAMP" \
  --arg audit_decision "$AUDIT_DECISION" \
  --arg test_stats "$TEST_STATS" \
  --argjson audit_l1 "$AUDIT_L1" \
  --argjson audit_l2 "$AUDIT_L2" \
  '{
    sha: $sha,
    branch: $branch,
    qa_gate_passed: true,
    audit_decision: $audit_decision,
    timestamp: $timestamp,
    evidence: {
      typecheck: "passed",
      tests: $test_stats,
      build: "success",
      audit_l1: $audit_l1,
      audit_l2: $audit_l2
    }
  }' > "$EVIDENCE_FILE"

echo "  质检证据已生成: .quality-evidence.json"
echo "    SHA: $CURRENT_SHA"
echo "    Audit: $AUDIT_DECISION (L1=$AUDIT_L1, L2=$AUDIT_L2)"
echo ""
echo "  Stop Hook 现在允许会话结束"
echo "  下一步: 创建 PR"
echo ""
