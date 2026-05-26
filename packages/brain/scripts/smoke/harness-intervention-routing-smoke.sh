#!/usr/bin/env bash
# harness-intervention-routing-smoke.sh
# 验证 harness_intervention 任务类型路由注册正确
set -euo pipefail

ROUTER="packages/brain/src/task-router.js"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. VALID_TASK_TYPES 包含 harness_intervention
node -e "
const s = require('fs').readFileSync('${ROUTER}', 'utf8');
const m = s.match(/const VALID_TASK_TYPES\s*=\s*\[[\s\S]*?\]/);
if (!m || !m[0].includes(\"'harness_intervention'\")) { process.exit(1); }
" && ok "VALID_TASK_TYPES 包含 harness_intervention" || fail "VALID_TASK_TYPES 缺少 harness_intervention"

# 2. LOCATION_MAP 显式映射 harness_intervention → us
node -e "
const s = require('fs').readFileSync('${ROUTER}', 'utf8');
if (!s.match(/'harness_intervention'\s*:\s*'us'/)) { process.exit(1); }
" && ok "LOCATION_MAP 包含 harness_intervention: 'us'" || fail "LOCATION_MAP 缺少 harness_intervention: 'us'"

# 3. SKILL_WHITELIST 包含 harness_intervention
node -e "
const s = require('fs').readFileSync('${ROUTER}', 'utf8');
if (!s.match(/'harness_intervention'\s*:\s*'[^']+'/)) { process.exit(1); }
" && ok "SKILL_WHITELIST 包含 harness_intervention" || fail "SKILL_WHITELIST 缺少 harness_intervention"

# 4. regression: dev → us 路由未被破坏
node -e "
const s = require('fs').readFileSync('${ROUTER}', 'utf8');
if (!s.match(/'dev'\s*:\s*'us'/)) { process.exit(1); }
" && ok "regression: dev → us 路由正常" || fail "regression: dev → us 被破坏"

# 5. 函数导出完整：isValidTaskType 可用
node -e "
const { isValidTaskType } = require('./${ROUTER}');
if (typeof isValidTaskType !== 'function') { process.exit(1); }
if (!isValidTaskType('harness_intervention')) { process.exit(1); }
if (!isValidTaskType('dev')) { process.exit(1); }
" && ok "isValidTaskType() 正确识别 harness_intervention 和 dev" || fail "isValidTaskType() 异常"

echo ""
echo "── 结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
