---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 单元层守护断言（fallback）

**范围**: 复跑 PR #2816 自带 unit test；该文件不存在时补 4 项 BEHAVIOR 单元测试守护 `runHarnessInitiativeRouter` 行为
**大小**: M（约 150–250 行 TS + vitest）
**依赖**: 与 WS1 并行；E2E 脚本 Step 5 依赖本 workstream 产物存在

## ARTIFACT 条目

- [ ] [ARTIFACT] fallback 测试文件存在
  Test: `node -e "require('fs').accessSync('sprints/golden-path-verify-20260507/tests/ws2/status-writeback-unit.test.ts')"`

- [ ] [ARTIFACT] 测试 import 真实生产代码 `runHarnessInitiativeRouter`（不是空 stub）
  Test: `node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/tests/ws2/status-writeback-unit.test.ts','utf8');if(!c.includes('runHarnessInitiativeRouter')||!c.includes('packages/brain/src/executor.js'))process.exit(1)"`

- [ ] [ARTIFACT] 测试至少 4 个 it() 块（对应 PRD 4 个边界情况）
  Test: `node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/tests/ws2/status-writeback-unit.test.ts','utf8');const m=c.match(/\\bit\\s*\\(/g)||[];if(m.length<4)process.exit(1)"`

- [ ] [ARTIFACT] 测试覆盖 watchdog 分支（grep 关键字）
  Test: `node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/tests/ws2/status-writeback-unit.test.ts','utf8');for(const k of ['watchdog','AbortError','failure_class'])if(!c.includes(k))process.exit(1)"`

- [ ] [ARTIFACT] 文档里写明 PRD 引用的 unit test 文件是否存在的判定逻辑
  Test: `node -e "const c=require('fs').readFileSync('sprints/golden-path-verify-20260507/contract-draft.md','utf8');if(!c.includes('executor-harness-initiative-status-writeback.test.js'))process.exit(1)"`

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/status-writeback-unit.test.ts`，覆盖：
- `runHarnessInitiativeRouter` 收到 graph `final={}`（无 error）→ 返回 `ok=true, finalState.error=undefined`
- 收到 `final={error:'evaluator_fail'}` → 返回 `ok=false, finalState.error='evaluator_fail'`
- compiled.stream 抛 AbortError（watchdog deadline）→ 写 `task.failure_class='watchdog_deadline'`，返回 `ok=false, error='watchdog_deadline'`
- compiled.stream 抛任意未知异常 → 异常向上抛（被外层 caller catch），不污染 task row 的 failure_class 字段
