#!/usr/bin/env bash
#
# l2a-check.sh - L2A (PRD/DoD/QA/Audit) 远端检查
#
# 目标：把 L2A 从本地 hook 搬到远端 CI，成为不可绕过的 required check
#
# 用法：
#   bash scripts/devgate/l2a-check.sh [pr|release]
#
# 模式：
#   pr (默认): PR to develop/main 的基本检查
#   release:   PR to main 的更严格检查
#
# Exit code:
#   0: 全部通过
#   2: L2A 失败
#   1: 脚本异常
#

set -euo pipefail

# ============================================================================
# 配置
# ============================================================================

MODE="${1:-pr}"

# 文件路径
PRD_FILE=".prd.md"
DOD_FILE=".dod.md"
QA_DECISION_FILE="docs/QA-DECISION.md"
AUDIT_REPORT_FILE="docs/AUDIT-REPORT.md"

# 计数器
PASSED=0
FAILED=0
FAILED_ITEMS=()

# ============================================================================
# 辅助函数
# ============================================================================

log_pass() {
  echo "  ✅ OK: $1"
  PASSED=$((PASSED + 1))
}

log_fail() {
  echo "  ❌ L2A_FAIL: $1" >&2
  FAILED_ITEMS+=("$1")
  FAILED=$((FAILED + 1))
}

# 统计非空行数（去掉空行和只有空白符的行）
count_non_empty_lines() {
  local file="$1"
  grep -v '^\s*$' "$file" 2>/dev/null | wc -l || echo 0
}

# ============================================================================
# 检查函数
# ============================================================================

check_prd() {
  echo ""
  echo "[1/4] Checking .prd.md..."

  if [[ ! -f "$PRD_FILE" ]]; then
    log_fail ".prd.md missing"
    return
  fi

  local lines
  lines=$(count_non_empty_lines "$PRD_FILE")
  if [[ $lines -lt 3 ]]; then
    log_fail ".prd.md too short (need >= 3 non-empty lines, got $lines)"
    return
  fi

  log_pass ".prd.md"
}

check_dod() {
  echo ""
  echo "[2/4] Checking .dod.md..."

  if [[ ! -f "$DOD_FILE" ]]; then
    log_fail ".dod.md missing"
    return
  fi

  local lines
  lines=$(count_non_empty_lines "$DOD_FILE")
  if [[ $lines -lt 3 ]]; then
    log_fail ".dod.md too short (need >= 3 non-empty lines, got $lines)"
    return
  fi

  if ! grep -q 'QA:' "$DOD_FILE" 2>/dev/null; then
    log_fail ".dod.md missing 'QA:' reference"
    return
  fi

  # Release 模式：检查全勾选
  if [[ "$MODE" == "release" ]]; then
    if grep -qE '^\s*-\s*\[\s*\]' "$DOD_FILE" 2>/dev/null; then
      log_fail ".dod.md has unchecked items (release requires all checked)"
      return
    fi
  fi

  log_pass ".dod.md"
}

check_qa_decision() {
  echo ""
  echo "[3/4] Checking docs/QA-DECISION.md..."

  if [[ ! -f "$QA_DECISION_FILE" ]]; then
    log_fail "docs/QA-DECISION.md missing"
    return
  fi

  if ! grep -q 'Decision:' "$QA_DECISION_FILE" 2>/dev/null; then
    log_fail "QA decision missing 'Decision:' field"
    return
  fi

  # Release 模式：必须 Decision: PASS
  if [[ "$MODE" == "release" ]]; then
    if ! grep -qE '^Decision:\s*PASS' "$QA_DECISION_FILE" 2>/dev/null; then
      log_fail "QA decision not PASS (release requires PASS)"
      return
    fi
  fi

  log_pass "docs/QA-DECISION.md"
}

check_audit_report() {
  echo ""
  echo "[4/4] Checking docs/AUDIT-REPORT.md..."

  if [[ ! -f "$AUDIT_REPORT_FILE" ]]; then
    log_fail "docs/AUDIT-REPORT.md missing"
    return
  fi

  if ! grep -qE '^Decision:\s*PASS' "$AUDIT_REPORT_FILE" 2>/dev/null; then
    log_fail "audit decision not PASS"
    return
  fi

  log_pass "docs/AUDIT-REPORT.md"
}

# ============================================================================
# Main
# ============================================================================

main() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  L2A Check: mode=$MODE"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # 验证模式
  if [[ "$MODE" != "pr" && "$MODE" != "release" ]]; then
    echo "❌ Invalid mode: $MODE (must be 'pr' or 'release')" >&2
    exit 1
  fi

  # 执行检查
  check_prd
  check_dod
  check_qa_decision
  check_audit_report

  # 输出汇总
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if [[ $FAILED -eq 0 ]]; then
    echo "  ✅ L2A_SUMMARY: passed=$PASSED failed=0"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
  else
    echo "  ❌ L2A_SUMMARY: passed=$PASSED failed=$FAILED"
    echo ""
    echo "  Failed items:"
    for item in "${FAILED_ITEMS[@]}"; do
      echo "    - $item"
    done
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 2
  fi
}

main
