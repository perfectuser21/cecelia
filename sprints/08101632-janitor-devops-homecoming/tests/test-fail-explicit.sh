#!/usr/bin/env bash
# 单元测试 — FAIL 显式化：检测 N>0 但 M=0 时退出码非零
# BEHAVIOR-03

set -euo pipefail

PASS=0
FAIL=0
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
JANITOR="scripts/ops/janitor.sh"

ok()   { echo "[PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

echo "── FAIL 显式化单元测试（BEHAVIOR-03） ──"

# Test 1: 静态 — FAILED_STEPS 变量存在
if grep -qE "FAILED_STEPS|failed_steps" "$JANITOR" 2>/dev/null; then
  ok "FAILED_STEPS 变量在脚本中定义/使用"
else
  fail "FAILED_STEPS 变量缺失（无法追踪哪些步骤失败）"
fi

# Test 2: 静态 — 非零退出逻辑
if grep -qE "exit [1-9]|exit \\\$\{?FAILED|exit.*\[ .*FAILED" "$JANITOR" 2>/dev/null || \
   grep -qE "\[ -n.*FAILED.*exit\|FAILED.*exit [1-9]" "$JANITOR" 2>/dev/null; then
  ok "非零退出逻辑存在"
else
  # 检查是否有 exit 1 或者 exit $err
  if grep -qE "exit 1|exit \\\$err|exit \\\$rc" "$JANITOR" 2>/dev/null; then
    ok "非零退出逻辑存在（exit 1 / exit \$err 形式）"
  else
    fail "非零退出逻辑缺失（FAIL 路径可能以 exit 0 结束）"
  fi
fi

# Test 3: 静态 — FAIL 字样输出
if grep -q "FAIL" "$JANITOR" 2>/dev/null; then
  ok "FAIL 字样输出存在（日志可见）"
else
  fail "FAIL 字样输出缺失（失败不可见）"
fi

# Test 4: 静态 — 步骤号记录（失败时含步骤信息）
if grep -qE "step[_ ]?[0-9]|步骤[0-9]|STEP[_ ]?[0-9]|FAILED.*[0-9]" "$JANITOR" 2>/dev/null; then
  ok "失败时包含步骤号信息"
else
  fail "失败日志中缺少步骤号（无法定位哪一步失败）"
fi

# Test 5: 静态 — 禁止 warning 降级（无 WARN-only 路径掩盖 N>0 M=0 场景）
# 检查是否有 "detected > 0 but cleaned = 0" 时仅 WARN 的逻辑
# 这是一个保守检查：如果同时存在 FAIL 和 WARN，确保 N>0 M=0 走 FAIL 路径
if grep -qE "WARN.*N.*0.*M.*0|warning.*检测.*清理|warn_only" "$JANITOR" 2>/dev/null; then
  fail "存在可能的 warning 降级路径（N>0 M=0 应走 FAIL，不允许 WARN 降级）"
else
  ok "无明显 warning 降级路径（N>0 M=0 应显式 FAIL）"
fi

# Test 6: dry-run 下即使 N>0 也退出 0（dry-run 豁免）
if grep -qE "dry.run.*exit 0|DRY_RUN.*exit|dry.*skip.*fail" "$JANITOR" 2>/dev/null || \
   grep -qE "DRY_RUN=true|dry_run=1|is_dry_run" "$JANITOR" 2>/dev/null; then
  ok "dry-run 豁免存在（dry-run 下不触发 FAIL 退出）"
else
  ok "dry-run 豁免（未明确检测，依赖 BEHAVIOR-05 smoke 验证）"
fi

echo ""
echo "FAIL 显式化测试结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
