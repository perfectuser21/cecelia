#!/usr/bin/env bash
# headless-cancel-smoke.test.sh — 合同测试（Red 基线）
# 验证 headless-cancel-smoke.sh 存在并满足合同断言 B1-B7
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
SMOKE_SCRIPT="packages/brain/scripts/smoke/headless-cancel-smoke.sh"
ALLOWLIST="packages/quality/smoke-allowlist.txt"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── headless-cancel-smoke 合同测试 ──"

# B1: 脚本文件存在
[ -f "$SMOKE_SCRIPT" ] \
  && ok "B1: smoke 脚本文件存在" \
  || fail "B1: smoke 脚本不存在: $SMOKE_SCRIPT"

# B2: 脚本行数 < 60
if [ -f "$SMOKE_SCRIPT" ]; then
  LINES=$(wc -l < "$SMOKE_SCRIPT")
  [ "$LINES" -lt 60 ] \
    && ok "B2: 行数 $LINES < 60" \
    || fail "B2: 行数 $LINES >= 60，超出 NFR-01 限制"
fi

# B3: 无 jq 依赖（禁止）
if [ -f "$SMOKE_SCRIPT" ]; then
  grep -qE '(^|\s)jq(\s|$|")' "$SMOKE_SCRIPT" 2>/dev/null \
    && fail "B3: 脚本含禁止依赖 jq（违反 NFR-02）" \
    || ok "B3: 无 jq 依赖（NFR-02 合规）"
fi

# B4: 包含 PATCH status=cancelled（取消清理路径）
if [ -f "$SMOKE_SCRIPT" ]; then
  grep -q 'cancelled' "$SMOKE_SCRIPT" \
    && ok "B4: 脚本含取消清理路径（PATCH cancelled）" \
    || fail "B4: 脚本缺 cancelled 逻辑"
fi

# B5: allowlist 已登记
grep -q 'headless-cancel-smoke.sh' "$ALLOWLIST" 2>/dev/null \
  && ok "B5: smoke-allowlist.txt 已登记（I-02 合规）" \
  || fail "B5: smoke-allowlist.txt 未登记 headless-cancel-smoke.sh"

# B6: 探针 title 正确（可重入 NFR-03）
if [ -f "$SMOKE_SCRIPT" ]; then
  grep -q 'headless-cancel-probe-test' "$SMOKE_SCRIPT" \
    && ok "B6: 探针 title 正确（headless-cancel-probe-test）" \
    || fail "B6: 探针 title 不对（期望 headless-cancel-probe-test）"
fi

# B7: Brain 可达时脚本端到端运行成功
if curl -sf "$BRAIN/api/brain/healthz" >/dev/null 2>&1; then
  if [ -f "$SMOKE_SCRIPT" ] && bash "$SMOKE_SCRIPT" >/dev/null 2>&1; then
    ok "B7: smoke 脚本端到端运行成功（Brain 可达）"
  else
    fail "B7: smoke 脚本运行失败（Brain 可达但脚本异常）"
  fi
else
  echo "  ⚠️  Brain 不可达，跳过 B7 实跑（sad path 由脚本内置守卫覆盖）"
fi

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
