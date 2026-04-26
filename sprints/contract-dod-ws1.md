# Contract DoD — Workstream 1: Spawn Onion Chain Assembly + V2 开关

**范围**: `packages/brain/src/spawn/spawn.js` 升级为真两层洋葱链；新增 `SPAWN_V2_ENABLED` 回滚开关（V2-disabled 路径必须保留 `markSpendingCap` 副作用，对应 R2 mitigation）；更新 `packages/brain/src/spawn/README.md` 状态行
**大小**: M（spawn.js 约 +180 行；测试约 +250 行；README 1 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] spawn.js 必须 import 全部 4 个外层 middleware（cost-cap / spawn-pre / logging / billing）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/spawn.js','utf8');const m=['cost-cap','spawn-pre','logging','billing'];for(const x of m){if(!new RegExp('from\\\\s+[\\'\"\\\\.]+/middleware/'+x).test(c)){console.error('missing import:',x);process.exit(1)}}"

- [ ] [ARTIFACT] spawn.js 必须 import 全部 6 个内层 middleware（account-rotation / cascade / resource-tier / docker-run / cap-marking / retry-circuit）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/spawn.js','utf8');const m=['account-rotation','cascade','resource-tier','docker-run','cap-marking','retry-circuit'];for(const x of m){if(!new RegExp('from\\\\s+[\\'\"\\\\.]+/middleware/'+x).test(c)){console.error('missing import:',x);process.exit(1)}}"

- [ ] [ARTIFACT] spawn.js 必须存在 `SPAWN_V2_ENABLED` 字面量（环境变量读取或常量定义）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/spawn.js','utf8');if(!/SPAWN_V2_ENABLED/.test(c))process.exit(1)"

- [ ] [ARTIFACT] spawn.js 默认 SPAWN_V2_ENABLED 行为为 true（未显式 false 时走洋葱链）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/spawn.js','utf8');if(!/SPAWN_V2_ENABLED\\s*[!=]==?\\s*['\"]false['\"]|SPAWN_V2_ENABLED\\s*===\\s*['\"]false['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] spawn.js V2-disabled 分支必须保留 `markSpendingCap` 调用（R2 mitigation 副作用守卫）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/spawn.js','utf8');if(!/markSpendingCap|checkCap/.test(c)){console.error('V2-disabled branch missing cap-marking side effect');process.exit(1)}"

- [ ] [ARTIFACT] spawn/__tests__/spawn.test.js 文件 it() 块数量 ≥ 10
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/__tests__/spawn.test.js','utf8');const n=(c.match(/^\\s*it\\(/gm)||[]).length;if(n<10){console.error('it count:',n);process.exit(1)}"

- [ ] [ARTIFACT] spawn/README.md 必须含 "P2 接线完成" 字样
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/README.md','utf8');if(!c.includes('P2 接线完成'))process.exit(1)"

- [ ] [ARTIFACT] spawn 单元测试套件（含原 7 case + 扩展 ≥ 3 case）全部 PASS
  Test: bash -c "cd /workspace && npx vitest run packages/brain/src/spawn/__tests__/spawn.test.js --reporter=basic 2>&1 | tail -5 | grep -E 'Tests.*passed|✓.*passed' >/dev/null"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/spawn-onion.test.ts`，覆盖：
- SPAWN_V2_ENABLED unset (default true): runs full onion chain — outer 4 + inner 6 middleware all invoked once on success
- SPAWN_V2_ENABLED=false: bypasses spawn/middleware/* — outer/inner middleware mock invocation count is 0, executeInDocker is called directly（"0 触发"语义已澄清：spawn.js import 自 spawn/middleware/* 的模块函数 0 触发；docker-executor.js 内部 helper 不计）
- V2 disabled: legacy path still marks spending cap on 429 — markSpendingCap (or cap-marking) invoked at least once when executeInDocker returns api_error_status:429（R2 回归护栏）
- account capped fallback: account1 marked capped → account-rotation selects account2/3, billing records actual account
- cascade preserves sonnet across accounts: at least 3 attempts keep model in sonnet family before any opus/haiku/minimax downgrade（R1 mitigation）
- 429 transient retry: attempt 0 → cap-marking marks account, attempt 1 account-rotation switches account, no env delete（R4）
- cost-cap blocks spawn: when getBudget reports usage_usd >= usd, spawn rejects with CostCapExceededError（R5）
- SPAWN_V2_ENABLED=true preserves attempt-loop semantics: transient × 3 still gives up after MAX_ATTEMPTS=3
- billing payload contains exactly the legacy field set: dispatched_account + dispatched_model (key set byte-equal with executor.js legacy UPDATE)（R3 mitigation）
