#!/usr/bin/env bash
# check-delivery-type.sh
# CI DevGate: behavior-change 类型任务必须有对应测试文件
# 用法: bash check-delivery-type.sh [branch_name]
# 退出码: 0=通过, 1=失败

set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')}"
DOD_FILE=".dod-${BRANCH}.md"

# 若无 DoD 文件，跳过（由 check-dod-mapping.cjs 负责报缺失）
if [ ! -f "$DOD_FILE" ]; then
  echo "[check-delivery-type] No DoD file found for branch ${BRANCH}, skipping."
  exit 0
fi

# 检查 DoD 文件中是否声明了 delivery_type=behavior-change
if ! grep -qi 'behavior.change' "$DOD_FILE" && ! grep -qi 'delivery_type.*behavior' "$DOD_FILE"; then
  echo "[check-delivery-type] delivery_type is not behavior-change, skipping."
  exit 0
fi

echo "[check-delivery-type] delivery_type=behavior-change detected, checking for test evidence..."

FAIL=0

# 规则 1: 必须有对应测试文件（*.test.js 或 *.test.mjs 或 *.spec.js）
TEST_FILES=$(git diff --name-only origin/main...HEAD 2>/dev/null | grep -E '\.(test|spec)\.(js|mjs|cjs|ts)$' || true)
if [ -z "$TEST_FILES" ]; then
  echo "  [FAIL] behavior-change PR must include at least one test file (*.test.js / *.spec.js)"
  FAIL=1
else
  echo "  [PASS] Test files found:"
  echo "$TEST_FILES" | sed 's/^/    /'
fi

# 规则 2: PR body 必须包含 SYSTEM BEHAVIOR CHANGE 段
PR_BODY=$(gh pr view "$BRANCH" --json body -q '.body' 2>/dev/null || echo '')
if [ -n "$PR_BODY" ]; then
  if echo "$PR_BODY" | grep -qi 'SYSTEM BEHAVIOR CHANGE'; then
    echo "  [PASS] PR body contains SYSTEM BEHAVIOR CHANGE section"
  else
    echo "  [FAIL] behavior-change PR body must contain '## SYSTEM BEHAVIOR CHANGE' section"
    FAIL=1
  fi
else
  echo "  [SKIP] Could not read PR body (PR may not exist yet)"
fi

if [ "$FAIL" -eq 1 ]; then
  echo ""
  echo "[check-delivery-type] FAILED: behavior-change evidence requirements not met."
  exit 1
fi

echo "[check-delivery-type] PASSED"
exit 0
