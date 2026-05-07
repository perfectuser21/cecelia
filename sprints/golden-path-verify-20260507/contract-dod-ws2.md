---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: dispatcher 防回路 + 单元守护

**范围**：脚本 + 测试，断言 (a) dispatcher 不重复拉起目标 task_id；(b) PR #2816 自带 4 项单元断言不退化。
**大小**：S
**依赖**：Workstream 1（Step 4 的 SQL 起点取自 Step 3 落 DB 后的 `started_at`）

## ARTIFACT 条目

- [ ] [ARTIFACT] 防回路 / 单元守护脚本存在并可执行
  Test: bash -c 'test -x sprints/golden-path-verify-20260507/scripts/check-no-redispatch-and-units.sh || exit 1'

- [ ] [ARTIFACT] 脚本含 dispatch_count ≤ 1 硬阈值断言（针对目标 task_id）
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/scripts/check-no-redispatch-and-units.sh','utf8');if(!c.includes('tick_decisions')||!c.includes('84075973-99a4-4a0d-9a29-4f0cd8b642f5')||!c.match(/-le\s+1|<=\s*1/))process.exit(1)"

- [ ] [ARTIFACT] 脚本含 PR #2816 单元守护文件路径 `executor-harness-initiative-status-writeback.test.js`
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/scripts/check-no-redispatch-and-units.sh','utf8');if(!c.includes('executor-harness-initiative-status-writeback.test.js'))process.exit(1)"

- [ ] [ARTIFACT] 脚本含 it() 计数 ≥ 4 硬阈值（防止偷偷删测试）
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/scripts/check-no-redispatch-and-units.sh','utf8');if(!c.match(/IT_COUNT[\s\S]{0,80}-ge\s+4|>=\s*4/))process.exit(1)"

- [ ] [ARTIFACT] vitest 测试文件存在且引用 PR #2816 守护文件路径
  Test: node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/tests/ws2/no-regression.test.ts','utf8');if(!c.includes('executor-harness-initiative-status-writeback.test.js'))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/no-regression.test.ts`，覆盖：
- PR #2816 单元守护文件 `packages/brain/src/__tests__/executor-harness-initiative-status-writeback.test.js` 存在
- 该文件中 `it(` 数量 ≥ 4
- 脚本 `scripts/check-no-redispatch-and-units.sh` 含 `tick_decisions` SQL 与 `dispatch_count ≤ 1` 阈值
