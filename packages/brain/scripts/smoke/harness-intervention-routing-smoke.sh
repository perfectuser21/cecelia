#!/usr/bin/env bash
# harness-intervention-routing-smoke.sh
# 验证 harness_intervention 任务类型路由注册正确
#
# PR1-B 起四张路由表（VALID_TASK_TYPES / SKILL_WHITELIST / LOCATION_MAP /
# TASK_REQUIREMENTS）已从 task-router.js 的字面量搬进 lib/task-type-registry.js，
# 本 smoke 由「grep 源码文本」改为「真 import 注册表求值」——问运行时的值，
# 比匹配源码字符串更难骗过，也不会因为搬家/换行再次假红。
set -euo pipefail

REGISTRY="packages/brain/src/lib/task-type-registry.js"
ROUTER="packages/brain/src/task-router.js"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. VALID_TASK_TYPES 包含 harness_intervention
node --input-type=module -e "
import { VALID_TASK_TYPES } from './${REGISTRY}';
if (!VALID_TASK_TYPES.includes('harness_intervention')) process.exit(1);
" && ok "VALID_TASK_TYPES 包含 harness_intervention" || fail "VALID_TASK_TYPES 缺少 harness_intervention"

# 2. LOCATION_MAP 显式映射 harness_intervention → us
node --input-type=module -e "
import { LOCATION_MAP } from './${REGISTRY}';
if (LOCATION_MAP['harness_intervention'] !== 'us') process.exit(1);
" && ok "LOCATION_MAP 包含 harness_intervention: 'us'" || fail "LOCATION_MAP 缺少 harness_intervention: 'us'"

# 3. SKILL_WHITELIST 包含 harness_intervention
node --input-type=module -e "
import { SKILL_WHITELIST } from './${REGISTRY}';
const v = SKILL_WHITELIST['harness_intervention'];
if (typeof v !== 'string' || v.length === 0) process.exit(1);
" && ok "SKILL_WHITELIST 包含 harness_intervention" || fail "SKILL_WHITELIST 缺少 harness_intervention"

# 4. regression: dev → us 路由未被破坏
node --input-type=module -e "
import { LOCATION_MAP } from './${REGISTRY}';
if (LOCATION_MAP['dev'] !== 'us') process.exit(1);
" && ok "regression: dev → us 路由正常" || fail "regression: dev → us 被破坏"

# 5. 函数导出完整：isValidTaskType 可用（仍走 task-router.js，验消费方真的接上了注册表）
node --input-type=module -e "
import { isValidTaskType } from './${ROUTER}';
if (typeof isValidTaskType !== 'function') process.exit(1);
if (!isValidTaskType('harness_intervention')) process.exit(1);
if (!isValidTaskType('dev')) process.exit(1);
" && ok "isValidTaskType() 正确识别 harness_intervention 和 dev" || fail "isValidTaskType() 异常"

echo ""
echo "── 结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
