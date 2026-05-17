# DoD — feat(brain): harness executor 可靠性升级 (W1+W3+W4)

## 验收标准

- [x] [ARTIFACT] `packages/brain/migrations/268_task_events.sql` 存在并定义 `task_events` 表
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/migrations/268_task_events.sql','utf8');if(!c.includes('CREATE TABLE IF NOT EXISTS task_events')||!c.includes('event_type'))process.exit(1);console.log('OK')"`

- [x] [ARTIFACT] `packages/brain/src/selfcheck.js` `EXPECTED_SCHEMA_VERSION='268'`
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8');if(!c.includes(\"'268'\"))process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] W1 thread_id 版本化通过 — fresh / 升级 / resume 三场景全绿
  Test: tests/integration/harness-thread-id-versioning.test.js

- [x] [BEHAVIOR] W3 AbortSignal — deadline 已过触发 abort 标 watchdog_deadline 不抛错
  Test: tests/integration/harness-watchdog.test.js

- [x] [BEHAVIOR] W3 兜底扫描 — scanStuckHarness 标 phase=failed failure_reason=watchdog_overdue
  Test: tests/integration/harness-watchdog-tick.test.js

- [x] [BEHAVIOR] W4 streamMode — 5 节点 stream → emitGraphNodeUpdate 5 次，config.streamMode='updates'
  Test: tests/integration/harness-stream-events.test.js

- [x] [BEHAVIOR] runHarnessInitiativeRouter 已 export，inline 路由调用替换为函数调用
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!c.includes('export async function runHarnessInitiativeRouter')||!c.includes('await runHarnessInitiativeRouter(task)'))process.exit(1);console.log('OK')"`
