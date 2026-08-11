#!/usr/bin/env bash
# Smoke: coding-route-kernel — 改代码任务派发时打标 code_change+gear 强制进 kernel harness（决策 bf361265，sprint 08111158）
# 验证（真执行纯函数 + 真接线核查，无 DB/无网络）：
#   1. task-router 真导出并真跑 classifyCodeChange / resolveDispatchChannel / CODE_CHANGE_TASK_TYPES
#      - dev/codex_dev → code_change=true & channel=kernel
#      - research/arch_review/talk/data → code_change=false & channel=legacy（非改代码行为不变）
#      - 白名单外 + payload.code_change=true 显式扩展点 → code_change=true & kernel
#   2. dispatcher 真接线：spawn 前 reroute 到 harness_initiative + merge 打标（源码断言 import/调用就位）
#   3. deriveGear 真跑：dev 任务缺省档 → 'default'（reroute 打标取值来源）
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "[coding-route-smoke] 1. task-router 分类纯函数真跑"
node -e "
(async () => {
  const { classifyCodeChange, resolveDispatchChannel, CODE_CHANGE_TASK_TYPES } = await import('./packages/brain/src/task-router.js');
  const assert = (cond, msg) => { if (!cond) { console.error('  FAIL: ' + msg); process.exit(1); } };
  assert(CODE_CHANGE_TASK_TYPES instanceof Set, 'CODE_CHANGE_TASK_TYPES 应为 Set');
  assert(CODE_CHANGE_TASK_TYPES.has('dev') && CODE_CHANGE_TASK_TYPES.has('codex_dev'), '白名单含 dev/codex_dev');
  for (const tt of ['dev', 'codex_dev']) {
    assert(classifyCodeChange({ task_type: tt, payload: {} }).code_change === true, tt + ' → code_change=true');
    assert(resolveDispatchChannel({ task_type: tt, payload: {} }) === 'kernel', tt + ' → channel=kernel');
  }
  for (const tt of ['research', 'arch_review', 'talk', 'data']) {
    assert(classifyCodeChange({ task_type: tt, payload: {} }).code_change === false, tt + ' → code_change=false');
    assert(resolveDispatchChannel({ task_type: tt, payload: {} }) === 'legacy', tt + ' → channel=legacy');
  }
  // 显式扩展点：白名单外 + payload.code_change=true
  assert(classifyCodeChange({ task_type: 'research', payload: { code_change: true } }).code_change === true, '显式 code_change 扩展点');
  assert(resolveDispatchChannel({ task_type: 'research', payload: { code_change: true } }) === 'kernel', '显式扩展点 → kernel');
  console.log('  ✓ 分类纯函数真跑通过');
})();
"

echo "[coding-route-smoke] 2. dispatcher reroute 接线核查"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/dispatcher.js', 'utf8');
const need = [
  [\"import { resolveDispatchChannel } from './task-router.js'\", 'import resolveDispatchChannel'],
  [\"import { deriveGear } from './harness-skill-relay.js'\", 'import deriveGear'],
  ['resolveDispatchChannel(taskToDispatch)', 'spawn 前调 resolveDispatchChannel'],
  [\"task_type: 'harness_initiative'\", 'reroute 到 harness_initiative'],
  ['origin_task_type', 'merge 打标 origin_task_type'],
];
const miss = need.filter(([p]) => !src.includes(p));
if (miss.length) { miss.forEach(([, d]) => console.error('  FAIL: dispatcher 缺 ' + d)); process.exit(1); }
console.log('  ✓ dispatcher reroute 五处接线就位');
"

echo "[coding-route-smoke] 3. deriveGear 缺省档真跑"
node -e "
(async () => {
  const { deriveGear } = await import('./packages/brain/src/harness-skill-relay.js');
  const g = deriveGear({ task_type: 'dev', payload: {} });
  if (g !== 'default') { console.error('  FAIL: dev 缺省 gear 应为 default, got ' + g); process.exit(1); }
  console.log('  ✓ deriveGear 缺省 = default');
})();
"

echo "[coding-route-smoke] ✅ ALL PASS"
