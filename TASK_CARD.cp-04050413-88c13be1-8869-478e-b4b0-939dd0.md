# Task Card: fix(brain): 内容流水线竞态 + 误重置 + 时间戳三 Bug 修复

## 任务 ID
88c13be1-8869-478e-b4b0-939dd02f2d57

## 背景
P0 诊断发现内容生成链路（KR 进度仅 1%）被三个联动 Bug 阻断：
1. **竞态**：PR #1888 只排除了 `content-export`，其余 5 种 pipeline 阶段类型仍可被 tick dispatch 派给 Codex，与本地 `executeQueuedContentTasks` 双路抢占同一任务
2. **误重置**：`restartStuckExecutors` 把无 PID 的 `content-pipeline` 父任务（内部编排，正常无 OS 进程）误判为僵尸，重置为 `queued`，触发重复编排循环
3. **时间戳缺失**：`_markPipelineFailed` 不写 `updated_at`，导致 pipeline 父任务 `completed_at > updated_at`，状态难以追踪

## 修复范围
- `packages/brain/src/tick.js`
- `packages/brain/src/alertness/healing.js`
- `packages/brain/src/content-pipeline-orchestrator.js`

## DoD

- [x] **[ARTIFACT]** `tick.js` `selectNextDispatchableTask` 中 `task_type NOT IN` 包含全部 6 种 pipeline 阶段类型
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(!c.includes('content-research') || !c.includes('content-copywriting'))process.exit(1);console.log('ok')"`

- [x] **[ARTIFACT]** `healing.js` `restartStuckExecutors` 的 SQL 已排除 `task_type = 'content-pipeline'`
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/alertness/healing.js','utf8');if(!c.includes(\"task_type != 'content-pipeline'\"))process.exit(1);console.log('ok')"`

- [x] **[ARTIFACT]** `_markPipelineFailed` 的 UPDATE 包含 `updated_at = NOW()`
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/content-pipeline-orchestrator.js','utf8');const m=c.match(/markPipelineFailed[\s\S]*?updated_at/);if(!m)process.exit(1);console.log('ok')"`

- [x] **[BEHAVIOR]** 现有测试套件通过
  - Test: tests/content-pipeline-orchestrator.test.js
