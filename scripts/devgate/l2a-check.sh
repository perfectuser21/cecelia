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

# 获取当前分支名（v1.1: 支持 CI 环境）
# CI 中优先使用 GITHUB_HEAD_REF（PR 源分支）
if [[ -n "${GITHUB_HEAD_REF:-}" ]]; then
  CURRENT_BRANCH="$GITHUB_HEAD_REF"
else
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
fi

# 文件路径（v1.1: 支持分支级别文件，向后兼容旧格式）
# 优先使用分支级别文件，再 fallback 到旧格式
if [[ -f ".prd-${CURRENT_BRANCH}.md" ]]; then
  PRD_FILE=".prd-${CURRENT_BRANCH}.md"
else
  PRD_FILE=".prd.md"
fi

if [[ -f ".dod-${CURRENT_BRANCH}.md" ]]; then
  DOD_FILE=".dod-${CURRENT_BRANCH}.md"
else
  DOD_FILE=".dod.md"
fi

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
  echo "[1/4] Checking PRD ($PRD_FILE)..."

  if [[ ! -f "$PRD_FILE" ]]; then
    log_fail "PRD missing ($PRD_FILE)"
    return
  fi

  local lines
  lines=$(count_non_empty_lines "$PRD_FILE")
  if [[ $lines -lt 3 ]]; then
    log_fail "PRD too short (need >= 3 non-empty lines, got $lines)"
    return
  fi

  # P1-1: 检查 PRD 结构（>=3 sections，每 section >=2 行）
  local section_count=0
  local current_section_lines=0
  local short_sections=()

  while IFS= read -r line; do
    # 检测 section 标题（## 开头）
    if [[ "$line" =~ ^##[[:space:]] ]]; then
      # 检查前一个 section 是否够长
      if [[ $section_count -gt 0 && $current_section_lines -lt 2 ]]; then
        short_sections+=("section $section_count has $current_section_lines lines")
      fi
      section_count=$((section_count + 1))
      current_section_lines=0
    elif [[ -n "$line" && ! "$line" =~ ^[[:space:]]*$ ]]; then
      # 非空行计入当前 section
      current_section_lines=$((current_section_lines + 1))
    fi
  done < "$PRD_FILE"

  # 检查最后一个 section
  if [[ $section_count -gt 0 && $current_section_lines -lt 2 ]]; then
    short_sections+=("section $section_count has $current_section_lines lines")
  fi

  if [[ $section_count -lt 3 ]]; then
    log_fail "PRD structure: need >= 3 sections (##), got $section_count"
    return
  fi

  if [[ ${#short_sections[@]} -gt 0 ]]; then
    log_fail "PRD density: some sections too short (need >= 2 lines each): ${short_sections[*]}"
    return
  fi

  log_pass "$PRD_FILE (sections=$section_count)"
}

check_dod() {
  echo ""
  echo "[2/4] Checking DoD ($DOD_FILE)..."

  if [[ ! -f "$DOD_FILE" ]]; then
    log_fail "DoD missing ($DOD_FILE)"
    return
  fi

  local lines
  lines=$(count_non_empty_lines "$DOD_FILE")
  if [[ $lines -lt 3 ]]; then
    log_fail "DoD too short (need >= 3 non-empty lines, got $lines)"
    return
  fi

  if ! grep -q 'QA:' "$DOD_FILE" 2>/dev/null; then
    log_fail "DoD missing 'QA:' reference"
    return
  fi

  # P1-1: 检查验收项数量和 Test 映射
  local checkbox_count=0
  local test_count=0
  local missing_test_lines=()

  while IFS= read -r -d '' line_with_num; do
    local line_num="${line_with_num%%:*}"
    local line_content="${line_with_num#*:}"

    # 检测验收项（- [ ] 或 - [x] 格式）
    if [[ "$line_content" =~ ^[[:space:]]*-[[:space:]]*\[[[:space:]xX]\] ]]; then
      checkbox_count=$((checkbox_count + 1))

      # 检查下一行是否有 Test: 字段（简单检测）
      local next_line_num=$((line_num + 1))
      local next_line
      next_line=$(sed -n "${next_line_num}p" "$DOD_FILE" 2>/dev/null || echo "")
      if [[ "$next_line" =~ ^[[:space:]]*Test: ]]; then
        test_count=$((test_count + 1))
      else
        missing_test_lines+=("L$line_num")
      fi
    fi
  done < <(grep -n '' "$DOD_FILE" | tr '\n' '\0')

  if [[ $checkbox_count -lt 1 ]]; then
    log_fail "DoD has no acceptance items (need >= 1 checkbox)"
    return
  fi

  if [[ ${#missing_test_lines[@]} -gt 0 ]]; then
    log_fail "DoD items missing Test: mapping at ${missing_test_lines[*]}"
    return
  fi

  # Release 模式：检查全勾选
  if [[ "$MODE" == "release" ]]; then
    if grep -qE '^\s*-\s*\[\s*\]' "$DOD_FILE" 2>/dev/null; then
      log_fail "DoD has unchecked items (release requires all checked)"
      return
    fi
  fi

  log_pass "$DOD_FILE (items=$checkbox_count, tests=$test_count)"
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
  # PRD/DoD 检查策略:
  # - Release 模式: 跳过 PRD/DoD（release 只是发布，不是新功能）
  # - CI 环境 + PR 模式（GITHUB_ACTIONS=true）: 跳过 PRD/DoD（它们是本地工作文档，不会提交到 develop/main）
  # - 本地 PR 模式: 检查 PRD/DoD（本地开发验证）
  if [[ "$MODE" == "release" ]]; then
    echo ""
    echo "  [Release 模式] 跳过 PRD/DoD 检查"
    PASSED=$((PASSED + 2))
  elif [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    echo ""
    echo "  [CI 模式] 跳过 PRD/DoD 检查（本地工作文档不提交）"
    PASSED=$((PASSED + 2))
  else
    check_prd
    check_dod
  fi
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
