#!/usr/bin/env bash
# 单元测试 — 台账 janitor-ledger.csv 追加验证
# BEHAVIOR-06

set -euo pipefail

PASS=0
FAIL=0
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
JANITOR="scripts/ops/janitor.sh"

ok()   { echo "[PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

echo "── 台账 ledger.csv 单元测试（BEHAVIOR-06） ──"

# Test 1: 静态 — ledger.csv 写入逻辑存在
if grep -q "janitor-ledger.csv" "$JANITOR" 2>/dev/null; then
  ok "janitor-ledger.csv 写入逻辑存在"
else
  fail "janitor-ledger.csv 写入逻辑缺失"
fi

# Test 2: 静态 — 追加模式（>> 而非 >）
if grep -qE ">> .*janitor-ledger.csv|>> .*ledger" "$JANITOR" 2>/dev/null; then
  ok "台账使用追加模式（>>）"
else
  fail "台账可能使用覆盖模式（>），应使用追加模式（>>）"
fi

# Test 3: 静态 — 台账格式包含必要字段
LEDGER_FIELDS=0
grep -q "ts\|timestamp\|date\|\$(date" "$JANITOR" 2>/dev/null && LEDGER_FIELDS=$((LEDGER_FIELDS+1))
grep -q "used_pct\|DISK_PCT\|used%" "$JANITOR" 2>/dev/null && LEDGER_FIELDS=$((LEDGER_FIELDS+1))
grep -q "avail_gb\|avail" "$JANITOR" 2>/dev/null && LEDGER_FIELDS=$((LEDGER_FIELDS+1))
grep -q "orphan_worktrees\|orphan" "$JANITOR" 2>/dev/null && LEDGER_FIELDS=$((LEDGER_FIELDS+1))
grep -q "failed_steps\|FAILED_STEPS" "$JANITOR" 2>/dev/null && LEDGER_FIELDS=$((LEDGER_FIELDS+1))
if [ "$LEDGER_FIELDS" -ge 4 ]; then
  ok "台账格式字段完整（命中 $LEDGER_FIELDS/5: ts/used_pct/avail_gb/orphan/failed_steps）"
else
  fail "台账格式字段不完整（仅命中 $LEDGER_FIELDS/5，期望 ≥4）"
fi

# Test 4: 静态 — ~/logs/ 目录不存在时自动创建
if grep -qE "mkdir -p.*logs|mkdir.*logs" "$JANITOR" 2>/dev/null; then
  ok "~/logs/ 目录自动创建逻辑存在（mkdir -p）"
else
  fail "~/logs/ 目录自动创建逻辑缺失（目录不存在时台账写入会失败）"
fi

# Test 5: 功能 — 实际运行后台账行数 +1
TMP_LOG_DIR=$(mktemp -d)
LEDGER_FILE="$TMP_LOG_DIR/janitor-ledger.csv"

# 记录运行前行数
BEFORE=0
[ -f "$LEDGER_FILE" ] && BEFORE=$(wc -l < "$LEDGER_FILE" | tr -d ' ')

# 运行 dry-run（台账写入不受 dry-run 影响）
HOME="$TMP_LOG_DIR" DISK_PCT=50 bash "$JANITOR" --mode daily --dry-run 2>/dev/null || true

# 记录运行后行数
AFTER=0
[ -f "$LEDGER_FILE" ] && AFTER=$(wc -l < "$LEDGER_FILE" | tr -d ' ')

DIFF=$((AFTER - BEFORE))
if [ "$DIFF" -eq 1 ]; then
  ok "台账追加恰好 1 行（运行前 $BEFORE 行 → 运行后 $AFTER 行）"
  # 验证行格式
  LAST_LINE=$(tail -1 "$LEDGER_FILE")
  FIELD_COUNT=$(echo "$LAST_LINE" | tr ',' '\n' | wc -l | tr -d ' ')
  if [ "$FIELD_COUNT" -ge 5 ]; then
    ok "台账行格式含 ≥5 个逗号分隔字段（实际: $FIELD_COUNT 个）"
  else
    fail "台账行格式字段不足（期望 ≥5 个，实际 $FIELD_COUNT 个）: $LAST_LINE"
  fi
elif [ "$DIFF" -eq 0 ]; then
  fail "台账未追加任何行（运行后仍为 $AFTER 行）"
else
  fail "台账追加行数异常（期望 1 行，实际 $DIFF 行）"
fi

# 清理
rm -rf "$TMP_LOG_DIR"

echo ""
echo "台账测试结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
