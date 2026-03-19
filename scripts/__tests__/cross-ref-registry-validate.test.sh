#!/usr/bin/env bash
# cross-ref-registry-validate.test.sh
# 验证 scripts/cross-ref-registry.yaml 格式完整性 + extract 命令可执行性

set -e

PASS=0
FAIL=0
YAML="scripts/cross-ref-registry.yaml"

# 切换到仓库根目录
cd "$(git rev-parse --show-toplevel)"

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "✅ $name"
    PASS=$((PASS+1))
  else
    echo "❌ $name (expected='$expected', got='$actual')"
    FAIL=$((FAIL+1))
  fi
}

assert_nonzero() {
  local name="$1" actual="$2"
  if [[ -n "$actual" && "$actual" != "0" ]]; then
    echo "✅ $name (output: $actual)"
    PASS=$((PASS+1))
  else
    echo "❌ $name (empty or zero output)"
    FAIL=$((FAIL+1))
  fi
}

# ─── Test 1: YAML 文件存在 ───
[[ -f "$YAML" ]] && { echo "✅ YAML 文件存在"; PASS=$((PASS+1)); } || { echo "❌ YAML 文件不存在"; FAIL=$((FAIL+1)); }

# ─── Test 2: 4 条规则都在文件中 ───
for rule in devmode-fields task-types skill-names model-ids; do
  grep -q "$rule" "$YAML" && { echo "✅ 规则存在: $rule"; PASS=$((PASS+1)); } || { echo "❌ 规则缺失: $rule"; FAIL=$((FAIL+1)); }
done

# ─── Test 3: devmode-fields extract 命令可执行 ───
DEVMODE_COUNT=$(grep -E 'step_[0-9]+_[a-z]+:|cleanup_done:|intent_expand_task_id:|cto_review_task_id:' \
  packages/engine/lib/devloop-check.sh | \
  grep -oE 'step_[0-9]+_[a-z]+|cleanup_done|intent_expand_task_id|cto_review_task_id' | \
  sort -u | grep -c step_ || echo "0")
assert_nonzero "devmode-fields extract 输出 step_ 字段数量" "$DEVMODE_COUNT"

# ─── Test 4: task-types extract 命令可执行 ───
TASK_TYPE_COUNT=$(node --input-type=module -e \
  "import { VALID_TASK_TYPES } from './packages/brain/src/task-router.js'; console.log(VALID_TASK_TYPES.length);" 2>/dev/null || echo "0")
assert_nonzero "task-types extract 输出类型数量" "$TASK_TYPE_COUNT"

# ─── Test 5: skill-names extract 命令可执行 ───
SKILL_COUNT=$(node --input-type=module -e \
  "import { SKILL_WHITELIST } from './packages/brain/src/task-router.js'; console.log(Object.keys(SKILL_WHITELIST).length);" 2>/dev/null || echo "0")
assert_nonzero "skill-names extract 输出 skill 数量" "$SKILL_COUNT"

# ─── Test 6: model-ids extract 命令可执行 ───
MODEL_COUNT=$(node --input-type=module -e \
  "import { MODELS } from './packages/brain/src/model-registry.js'; console.log(MODELS.length);" 2>/dev/null || echo "0")
assert_nonzero "model-ids extract 输出模型数量" "$MODEL_COUNT"

# ─── 结果汇总 ───
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  通过: $PASS  失败: $FAIL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[[ $FAIL -eq 0 ]] && exit 0 || exit 1
