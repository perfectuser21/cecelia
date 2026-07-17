#!/usr/bin/env bash
# Smoke: S2 锚点执法闸（MJ5 刀2）——anchor-check 模块结构 + 逻辑校验
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

# 1. anchor-check.js 文件存在且导出正确
[ -f "packages/brain/src/anchor-check.js" ] \
  || { echo "FAIL: anchor-check.js 不存在"; exit 1; }
echo "OK: anchor-check.js 存在"

grep -q "export function checkAnchor" packages/brain/src/anchor-check.js \
  || { echo "FAIL: checkAnchor 未导出"; exit 1; }
grep -q "export const ANCHOR_LEGACY_CUTOFF" packages/brain/src/anchor-check.js \
  || { echo "FAIL: ANCHOR_LEGACY_CUTOFF 未导出"; exit 1; }
echo "OK: checkAnchor + ANCHOR_LEGACY_CUTOFF 已导出"

# 2. dispatcher.js 已接入 anchor-check
grep -q "import.*anchor-check" packages/brain/src/dispatcher.js \
  || { echo "FAIL: dispatcher.js 未引入 anchor-check"; exit 1; }
grep -q "missing_anchor" packages/brain/src/dispatcher.js \
  || { echo "FAIL: dispatcher.js 缺少 missing_anchor 分支"; exit 1; }
echo "OK: dispatcher.js missing_anchor 分支存在"

# 3. dev SKILL.md PrepPRD 包含锚点节
grep -q "S2执法必填" packages/engine/skills/dev/SKILL.md \
  || { echo "FAIL: dev SKILL.md PrepPRD 缺少锚点节"; exit 1; }
echo "OK: dev SKILL.md PrepPRD 含锚点节"

# 4. 用 node 跑 checkAnchor 逻辑验证：无锚新任务应被拒
node --input-type=module -e "
import { checkAnchor } from './packages/brain/src/anchor-check.js';
const future = new Date(Date.now() + 86400000).toISOString();

// B1: 无锚新 dev 任务应被拒
const r1 = checkAnchor({ task_type: 'dev', created_at: future, payload: {} });
if (!r1.blocked || r1.reason !== 'missing_anchor') {
  console.error('FAIL: 无锚 dev 任务未被拦截', r1);
  process.exit(1);
}
console.log('OK: 无锚 dev 任务被拦截 (missing_anchor)');

// B2: 带锚放行
const r2 = checkAnchor({ task_type: 'dev', created_at: future, payload: { anchor: { journey_id: 'j1', gp_id: 'gp1', step_id: 's1' } } });
if (r2.blocked) {
  console.error('FAIL: 带锚 dev 任务被拦截', r2);
  process.exit(1);
}
console.log('OK: 带锚 dev 任务放行');

// B3: arch_review 免锚
const r3 = checkAnchor({ task_type: 'arch_review', created_at: future, payload: {} });
if (r3.blocked) {
  console.error('FAIL: arch_review 被拦截', r3);
  process.exit(1);
}
console.log('OK: arch_review 免锚放行');

// B4: spike action 免锚
const r4 = checkAnchor({ task_type: 'dev', created_at: future, payload: { action: 'spike' } });
if (r4.blocked) {
  console.error('FAIL: spike action 被拦截', r4);
  process.exit(1);
}
console.log('OK: spike action 免锚放行');

console.log('');
console.log('✅ anchor-check logic 验证全部通过');
"

echo ""
echo "✅ anchor-check smoke 全部通过"
