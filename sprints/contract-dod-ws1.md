# Contract DoD — Workstream 1: Spawn Onion Chain Assembly + V2 开关

**范围**: `packages/brain/src/spawn/spawn.js` 升级为真两层洋葱链；新增 `SPAWN_V2_ENABLED` 回滚开关；更新 `packages/brain/src/spawn/README.md` 状态行
**大小**: M（spawn.js 约 +160 行；测试约 +200 行；README 1 行）
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

- [ ] [ARTIFACT] spawn/__tests__/spawn.test.js 文件 it() 块数量 ≥ 10
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/__tests__/spawn.test.js','utf8');const n=(c.match(/^\\s*it\\(/gm)||[]).length;if(n<10){console.error('it count:',n);process.exit(1)}"

- [ ] [ARTIFACT] spawn/README.md 必须含 "P2 接线完成" 字样
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/README.md','utf8');if(!c.includes('P2 接线完成'))process.exit(1)"

- [ ] [ARTIFACT] spawn 单元测试套件（含原 7 case + 扩展 ≥ 3 case）全部 PASS
  Test: bash -c "cd /workspace && npx vitest run packages/brain/src/spawn/__tests__/spawn.test.js --reporter=basic 2>&1 | tail -5 | grep -E 'Tests.*passed|✓.*passed' >/dev/null"

## BEHAVIOR 索引（实际测试在 sprints/tests/ws1/）

见 `sprints/tests/ws1/spawn-onion.test.ts`，覆盖：
- SPAWN_V2_ENABLED unset (default true): runs full onion chain — outer 4 + inner 6 middleware all invoked once on success
- SPAWN_V2_ENABLED=false: bypasses all middleware, calls executeInDocker directly
- account capped fallback: account1 marked capped → account-rotation selects account2/3, billing records actual account
- cascade preserves sonnet across accounts: account1 sonnet capped does NOT trigger model downgrade
- 429 transient retry: attempt 0 → cap-marking marks account, attempt 1 account-rotation switches account, no env delete
- cost-cap blocks spawn: when getBudget reports usage_usd >= usd, spawn rejects with CostCapExceededError
- SPAWN_V2_ENABLED=true preserves attempt-loop semantics: transient × 3 still gives up after MAX_ATTEMPTS=3
