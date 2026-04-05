# Task Card: content-pipeline 幂等检查修复

**Task ID**: 840db267-3c84-4651-97be-ed4b7fb50ae2  
**Branch**: cp-04050228-840db267-3c84-4651-97be-ed4b7f

## 问题

`_startOnePipeline` 的幂等检查遗漏 `completed` 状态，导致 export 失败后 pipeline 被重排队时无限创建 research 子任务。

## 修复

`packages/brain/src/content-pipeline-orchestrator.js` 第 119 行：
- 旧: `AND status IN ('queued', 'in_progress')`
- 新: `AND status IN ('queued', 'in_progress', 'completed')`

## DoD

- [x] [ARTIFACT] `content-pipeline-orchestrator.js` 中 `_startOnePipeline` 的幂等检查包含 `'completed'` 状态
  - File: `packages/brain/src/content-pipeline-orchestrator.js`
  - Check: `node -e "const c=require('fs').readFileSync('packages/brain/src/content-pipeline-orchestrator.js','utf8');if(!c.includes(\"status IN ('queued', 'in_progress', 'completed')\"))process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] Brain 重启后 pipeline re-queue 不会重新创建已完成的 research 子任务
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/content-pipeline-orchestrator.js','utf8');const match=c.match(/status IN \\([^)]+\\)/g);if(!match||!match.some(m=>m.includes('completed')))process.exit(1);console.log('幂等检查包含 completed 状态 OK')"`
