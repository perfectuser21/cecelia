#!/usr/bin/env bash
# lint-migration-unique-version.test.sh — 自跑验证 lint-migration-unique-version.cjs
#
# 6 case：
#   A. 264 双胞胎（W7.4 事故复现）→ expect FAIL
#   B. 多组同号                   → expect FAIL
#   C. 三胞胎                     → expect FAIL
#   D. 全部唯一                   → expect PASS
#   E. 空目录                     → expect PASS
#   F. 含非数字前缀文件被忽略     → expect PASS
#
# 注意：故意不用 set -e，要让所有 case 跑完再统计。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINT="$SCRIPT_DIR/lint-migration-unique-version.cjs"

if [ ! -f "$LINT" ]; then
  echo "FATAL: lint not found: $LINT"
  exit 1
fi

PASSED=0
FAILED=0

run_case() {
  local name="$1" expect_fail="$2"
  shift 2

  local TMP
  TMP=$(mktemp -d)
  for f in "$@"; do
    : > "$TMP/$f"
  done

  node "$LINT" "$TMP" >/tmp/lint-mig-out.txt 2>&1
  local rc=$?

  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name] 正确拒（exit $rc）"
    PASSED=$((PASSED + 1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name] 正确放（exit 0）"
    PASSED=$((PASSED + 1))
  else
    echo "  FAIL [$name] expect_fail=$expect_fail got rc=$rc"
    cat /tmp/lint-mig-out.txt
    FAILED=$((FAILED + 1))
  fi

  rm -rf "$TMP"
}

# Case A: W7.4 事故复现 — 264 双胞胎
run_case "duplicate-264" 1 \
  "264_failure_type_dispatch_constraint.sql" \
  "264_fix_progress_ledger_unique.sql" \
  "265_initiative_journey_type.sql"

# Case B: 多组同号
run_case "multiple-dups" 1 \
  "100_a.sql" "100_b.sql" \
  "101_x.sql" "101_y.sql" \
  "102_unique.sql"

# Case C: 三胞胎
run_case "triplet" 1 \
  "050_a.sql" "050_b.sql" "050_c.sql"

# Case D: 全部唯一
run_case "all-unique" 0 \
  "001_base.sql" \
  "002_next.sql" \
  "003_more.sql"

# Case E: 空目录
run_case "empty" 0

# Case F: 非数字前缀被忽略（README-031.md 这类）
run_case "ignore-non-numeric" 0 \
  "001_a.sql" \
  "002_b.sql" \
  "archive_only.sql"

echo ""
echo "lint-migration-unique-version: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
