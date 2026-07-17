#!/usr/bin/env bash
# harness-gear-smoke.sh — 验证 gear 管道：deriveGear 纯函数 + executor 校验路径
# Task: 60a80ddc-421d-4b6c-8492-4b71a20c9adb
set -euo pipefail

PASS=0; FAIL=0
ok() { echo "  [PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }

echo "=== harness-gear-smoke ==="

# 1. deriveGear 单元：via Node inline
echo "--- 1. deriveGear 纯函数 ---"

node --input-type=module <<'JS'
import { deriveGear, GEAR_VALUES } from '/workspace/.claude/worktrees/cp-07170851-harness-gear-impl/packages/brain/src/harness-skill-relay.js';

let ok = 0, fail = 0;
function assert(label, cond) {
  if (cond) { console.log('  [PASS] ' + label); ok++; }
  else { console.log('  [FAIL] ' + label); fail++; }
}

// GEAR_VALUES 包含三个档位
assert('GEAR_VALUES 包含 default/hotfix/segmented',
  JSON.stringify(GEAR_VALUES) === JSON.stringify(['default','hotfix','segmented']));

// 缺省返回 default
assert('undefined payload.gear → default', deriveGear({payload:{}}) === 'default');
assert('null gear → default', deriveGear({payload:{gear:null}}) === 'default');
assert('无 payload → default', deriveGear({}) === 'default');

// 合法档位透传
assert('hotfix 透传', deriveGear({payload:{gear:'hotfix'}}) === 'hotfix');
assert('segmented 透传', deriveGear({payload:{gear:'segmented'}}) === 'segmented');
assert('default 透传', deriveGear({payload:{gear:'default'}}) === 'default');

// 非法档位抛出
let threw = false;
try { deriveGear({payload:{gear:'turbo'}}); } catch(e) { threw = e.message.includes('invalid_gear'); }
assert('非法 gear → throw invalid_gear', threw);

process.exit(fail > 0 ? 1 : 0);
JS
node_exit=$?
if [ $node_exit -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

# 2. GEAR_VALUES 导出检查（确保 JS 模块能正确导入）
echo "--- 2. ES module 导出检查 ---"
node --input-type=module <<'JS'
import { GEAR_VALUES, deriveGear } from '/workspace/.claude/worktrees/cp-07170851-harness-gear-impl/packages/brain/src/harness-skill-relay.js';
if (typeof deriveGear !== 'function') { console.log('  [FAIL] deriveGear 未导出'); process.exit(1); }
if (!Array.isArray(GEAR_VALUES)) { console.log('  [FAIL] GEAR_VALUES 未导出'); process.exit(1); }
console.log('  [PASS] deriveGear + GEAR_VALUES 导出正常');
JS
if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

# 3. executor.js 包含 gear 校验代码
echo "--- 3. executor.js gear 校验路径存在 ---"
EXEC_PATH="/workspace/.claude/worktrees/cp-07170851-harness-gear-impl/packages/brain/src/executor.js"
if grep -q 'deriveGear' "$EXEC_PATH" && grep -q 'invalid_gear' "$EXEC_PATH"; then
  ok "executor.js 含 deriveGear + invalid_gear 校验"
else
  fail "executor.js 缺失 gear 校验代码"
fi

# 4. harness-controller SKILL.md 含 gear 分叉
echo "--- 4. harness-controller 档位分流 ---"
CTRL_PATH="/workspace/.claude/worktrees/cp-07170851-harness-gear-impl/packages/workflows/skills/harness-controller/SKILL.md"
if grep -q 'gear=hotfix' "$CTRL_PATH" && grep -q 'gear=segmented' "$CTRL_PATH"; then
  ok "harness-controller SKILL.md 含 hotfix/segmented 分叉"
else
  fail "harness-controller SKILL.md 缺失 gear 分叉"
fi

# 5. harness-contract-proposer SKILL.md 含 Step 3.1 多 workstream
echo "--- 5. proposer 多 workstream 分支 ---"
PROP_PATH="/workspace/.claude/worktrees/cp-07170851-harness-gear-impl/packages/workflows/skills/harness-contract-proposer/SKILL.md"
if grep -q 'Step 3.1' "$PROP_PATH" && grep -q 'HARNESS_GEAR=segmented' "$PROP_PATH"; then
  ok "proposer SKILL.md 含 Step 3.1 segmented 多 workstream"
else
  fail "proposer SKILL.md 缺失 segmented 多 workstream 分支"
fi

# 6. harness-generator SKILL.md 含 WORKSTREAM_INDEX
echo "--- 6. generator WORKSTREAM_INDEX 定向 ---"
GEN_PATH="/workspace/.claude/worktrees/cp-07170851-harness-gear-impl/packages/workflows/skills/harness-generator/SKILL.md"
if grep -q 'WORKSTREAM_INDEX' "$GEN_PATH"; then
  ok "generator SKILL.md 含 WORKSTREAM_INDEX"
else
  fail "generator SKILL.md 缺失 WORKSTREAM_INDEX"
fi

# 7. harness-evaluator SKILL.md 含 SEGMENT_EVAL
echo "--- 7. evaluator SEGMENT_EVAL 段验 ---"
EVAL_PATH="/workspace/.claude/worktrees/cp-07170851-harness-gear-impl/packages/workflows/skills/harness-evaluator/SKILL.md"
if grep -q 'SEGMENT_EVAL' "$EVAL_PATH" && grep -q '回归棘轮' "$EVAL_PATH"; then
  ok "evaluator SKILL.md 含 SEGMENT_EVAL + 回归棘轮"
else
  fail "evaluator SKILL.md 缺失 SEGMENT_EVAL 段验"
fi

echo ""
echo "=== 结果：PASS=${PASS} FAIL=${FAIL} ==="
[ $FAIL -eq 0 ] && exit 0 || exit 1
