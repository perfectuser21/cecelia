#!/usr/bin/env bash
# harness-gear-smoke.sh — 验证 gear 档位校验端到端可达性
# 覆盖：executor.js gear 枚举校验逻辑（非法 gear 应被拒绝）
set -euo pipefail

PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── harness gear smoke ──"

# 1. 校验 ALLOWED_GEARS 枚举定义在 executor.js 中存在
SRC="packages/brain/src/executor.js"
if [ ! -f "$SRC" ]; then
  fail "executor.js 不存在：$SRC"
else
  grep -q "ALLOWED_GEARS" "$SRC" && ok "executor.js 含 ALLOWED_GEARS 枚举定义" || fail "executor.js 缺 ALLOWED_GEARS"
  grep -q "hotfix" "$SRC" && ok "executor.js 含 hotfix gear" || fail "executor.js 缺 hotfix gear"
  grep -q "segmented" "$SRC" && ok "executor.js 含 segmented gear" || fail "executor.js 缺 segmented gear"
  grep -q "invalid_gear_flag" "$SRC" && ok "executor.js 含非法 gear terminal fail 路径" || fail "executor.js 缺非法 gear 拦截"
fi

# 2. 校验 harness-skill-relay.js 注入 HARNESS_GEAR
RELAY="packages/brain/src/harness-skill-relay.js"
if [ ! -f "$RELAY" ]; then
  fail "harness-skill-relay.js 不存在：$RELAY"
else
  grep -q "HARNESS_GEAR" "$RELAY" && ok "harness-skill-relay.js 注入 HARNESS_GEAR" || fail "harness-skill-relay.js 缺 HARNESS_GEAR 注入"
  grep -q "payload?.gear" "$RELAY" && ok "harness-skill-relay.js 读取 payload.gear" || fail "harness-skill-relay.js 未读 payload.gear"
fi

# 3. 校验 harness-controller SKILL.md 含 gear 分叉
CTRL="packages/workflows/skills/harness-controller/SKILL.md"
if [ ! -f "$CTRL" ]; then
  fail "harness-controller/SKILL.md 不存在"
else
  grep -q "HARNESS_GEAR" "$CTRL" && ok "controller SKILL.md 含 HARNESS_GEAR 读取" || fail "controller SKILL.md 缺 HARNESS_GEAR"
  grep -q "hotfix.*免 GAN\|免 GAN.*hotfix" "$CTRL" && ok "controller SKILL.md 含 hotfix 免 GAN 直通" || fail "controller SKILL.md 缺 hotfix 分叉"
fi

# 4. 校验 evaluator SKILL.md 含段验旗标且无 ws_id 残留
EVAL="packages/workflows/skills/harness-evaluator/SKILL.md"
if [ ! -f "$EVAL" ]; then
  fail "harness-evaluator/SKILL.md 不存在"
else
  grep -q "IS_SEGMENT" "$EVAL" && ok "evaluator SKILL.md 含 IS_SEGMENT 段验旗标" || fail "evaluator SKILL.md 缺 IS_SEGMENT"
  # 去掉 frontmatter（首个 --- 到第二个 --- 之间）后检查 ws_id 残留
  BODY=$(awk '/^---/{c++; if(c==2){found=1; next}} found{print}' "$EVAL")
  if echo "$BODY" | grep -q "ws_id"; then
    fail "evaluator SKILL.md 正文含 ws_id 残留（contract guard 会失败）"
  else
    ok "evaluator SKILL.md 正文无 ws_id 残留"
  fi
fi

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
