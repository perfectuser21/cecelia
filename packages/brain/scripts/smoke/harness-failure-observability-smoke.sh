#!/usr/bin/env bash
set -euo pipefail
# Smoke: harness 失败可观测计量端点 GET /api/brain/harness/failure-stats（决策 e8f6134f 交付物2）
# 真环境验证：端点返回 200 + failure_rate 数值 + by_class 对象 + period_days，脏参回落 7、越界 clamp。
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── harness failure-observability smoke ──"

r=$(curl -sf "$BRAIN/api/brain/harness/failure-stats?days=7") || { fail "failure-stats GET 不可达"; r="{}"; }
echo "$r" | jq -e '.failure_rate | type == "number"' >/dev/null 2>&1 && ok "failure_rate 是数值" || fail "failure_rate 非数值"
echo "$r" | jq -e '.by_class | type == "object"' >/dev/null 2>&1 && ok "by_class 是对象" || fail "by_class 非对象"
echo "$r" | jq -e '.period_days == 7' >/dev/null 2>&1 && ok "period_days == 7" || fail "period_days 非 7"
echo "$r" | jq -e 'has("total_terminal_failed") and has("total_terminal_done")' >/dev/null 2>&1 \
  && ok "分母字段齐全" || fail "分母字段缺失"

# 脏参容错：days=abc 回落默认 7，不 500
d=$(curl -sf "$BRAIN/api/brain/harness/failure-stats?days=abc") || { fail "脏参 days=abc 非 200"; d="{}"; }
echo "$d" | jq -e '.period_days == 7' >/dev/null 2>&1 && ok "脏参回落 period_days=7" || fail "脏参未回落 7"

# 越界 clamp：days=999999 → period_days ∈ [1,365]
c=$(curl -sf "$BRAIN/api/brain/harness/failure-stats?days=999999") || { fail "越界 days 非 200"; c="{}"; }
echo "$c" | jq -e '.period_days >= 1 and .period_days <= 365' >/dev/null 2>&1 && ok "越界 clamp 到 [1,365]" || fail "越界未 clamp"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
