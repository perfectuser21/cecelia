# DoD — cleanup-content-pipeline-extended

**分支**: `cp-0427072030-cleanup-content-pipeline-extended`
**Brain Task**: `1a8a7363-e6f4-476d-8b16-0f4a5acb4d94`
**目标**: 删 in-Brain content-pipeline 全部代码（让 ZJ pipeline-worker 成为唯一 content 编排者）

## 成功标准

in-Brain content-pipeline 编排（orchestrator/executors/graph）全删，ZJ pipeline-worker 成为唯一 content 编排者；Cecelia 端只剩 task CRUD + can-run + LLM 服务接口。Brain 启动正常，所有非 deleted 测试通过。

## DoD 条目

- [x] [ARTIFACT] `packages/brain/src/content-pipeline-orchestrator.js` 已删除
  Test: manual:`node -e "const fs=require('fs');if(fs.existsSync('packages/brain/src/content-pipeline-orchestrator.js'))process.exit(1)"`

- [x] [ARTIFACT] `packages/brain/src/content-pipeline-executors.js` 已删除
  Test: manual:`node -e "const fs=require('fs');if(fs.existsSync('packages/brain/src/content-pipeline-executors.js'))process.exit(1)"`

- [x] [ARTIFACT] `packages/brain/src/content-pipeline-graph.js` 已删除（shim）
  Test: manual:`node -e "const fs=require('fs');if(fs.existsSync('packages/brain/src/content-pipeline-graph.js'))process.exit(1)"`

- [x] [ARTIFACT] `packages/brain/src/content-pipeline-graph-runner.js` 已删除（shim）
  Test: manual:`node -e "const fs=require('fs');if(fs.existsSync('packages/brain/src/content-pipeline-graph-runner.js'))process.exit(1)"`

- [x] [ARTIFACT] `packages/brain/src/workflows/content-pipeline.graph.js` 已删除
  Test: manual:`node -e "const fs=require('fs');if(fs.existsSync('packages/brain/src/workflows/content-pipeline.graph.js'))process.exit(1)"`

- [x] [ARTIFACT] `packages/brain/src/workflows/content-pipeline-runner.js` 已删除
  Test: manual:`node -e "const fs=require('fs');if(fs.existsSync('packages/brain/src/workflows/content-pipeline-runner.js'))process.exit(1)"`

- [x] [BEHAVIOR] `routes/content-pipeline.js` 不再 import 任何已删除的 content-pipeline 模块
  Test: manual:`node -e "const c=require('fs').readFileSync('packages/brain/src/routes/content-pipeline.js','utf8');if(c.match(/content-pipeline-(graph|orchestrator|executors|runner|graph-runner)/))process.exit(1)"`

- [x] [BEHAVIOR] `routes/content-pipeline.js` POST /:id/run-langgraph endpoint 已删除
  Test: manual:`node -e "const c=require('fs').readFileSync('packages/brain/src/routes/content-pipeline.js','utf8');if(c.includes('run-langgraph'))process.exit(1)"`

- [x] [BEHAVIOR] `routes/execution.js` 不再 dynamic import content-pipeline-orchestrator
  Test: manual:`node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(c.match(/import\\(.*content-pipeline-orchestrator/))process.exit(1)"`

- [x] [BEHAVIOR] `tick-runner.js` 注释更新为反映 ZJ pipeline-worker 接管
  Test: manual:`node -e "const c=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8');if(!c.includes('ZJ pipeline-worker'))process.exit(1)"`

- [x] [BEHAVIOR] Brain 版本 bump 到 1.226.0
  Test: manual:`node -e "const v=require('./packages/brain/package.json').version;if(v!=='1.226.0')process.exit(1)"`

- [x] [BEHAVIOR] 所有 content-pipeline 路由的 routes 测试仍通过（26 tests）
  Test: tests/__tests__/content-pipeline-routes.test.js

- [x] [ARTIFACT] smoke.sh 已新增
  Test: manual:`node -e "const fs=require('fs');if(!fs.existsSync('packages/brain/scripts/smoke/cleanup-content-pipeline-smoke.sh'))process.exit(1)"`

- [x] [ARTIFACT] Learning 文件已写
  Test: manual:`node -e "const c=require('fs').readFileSync('docs/learnings/cp-0427072030-cleanup-content-pipeline-extended.md','utf8');if(!c.includes('### 根本原因')||!c.includes('### 下次预防'))process.exit(1)"`
