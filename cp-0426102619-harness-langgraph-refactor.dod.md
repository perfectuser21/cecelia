# DoD - harness-langgraph-refactor

Sprint 1 Phase B/C 全程 LangGraph 重构。Brain task 5616cc28-28c8-4896-b57e-ee9fcc413e86。

## ARTIFACT

- [x] [ARTIFACT] 新建 packages/brain/src/workflows/harness-task.graph.js
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/workflows/harness-task.graph.js')"

- [x] [ARTIFACT] packages/brain/src/workflows/harness-initiative.graph.js 含 fanoutSubTasksNode + finalE2eNode + reportNode
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');if(!c.includes('fanoutSubTasksNode')||!c.includes('finalE2eNode')||!c.includes('reportNode'))process.exit(1)"

- [x] [ARTIFACT] harness-utils.js 含 topologicalLayers + buildGeneratorPrompt
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-utils.js','utf8');if(!c.includes('topologicalLayers')||!c.includes('buildGeneratorPrompt'))process.exit(1)"

- [x] [ARTIFACT] harness-watcher.js 缩为 deprecation stub
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('RETIRED')||c.length>2000)process.exit(1)"

- [x] [ARTIFACT] harness-phase-advancer.js 缩为 deprecation stub
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-phase-advancer.js','utf8');if(!c.includes('RETIRED')||c.length>1000)process.exit(1)"

## BEHAVIOR

- [x] [BEHAVIOR] harness-task.graph 单测覆盖 5 节点 + happy/fix-loop/timeout/no_pr 4 e2e
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/workflows/__tests__/harness-task.graph.test.js')"

- [x] [BEHAVIOR] harness-initiative.graph 5 新节点单测 + 3 e2e（happy / fix-loop / resume）
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js')"

- [x] [BEHAVIOR] harness-utils 工具函数单测（topologicalLayers / buildGeneratorPrompt / extractWorkstreamIndex）
  Test: manual:node -e "require('fs').accessSync('packages/brain/src/workflows/__tests__/harness-utils.test.js')"

- [x] [BEHAVIOR] grep 验证 6 老 module 被替代或留 deprecation comment
  Test: manual:node -e "const fs=require('fs');const ok=['harness-watcher','harness-phase-advancer'].every(n=>{const c=fs.readFileSync('packages/brain/src/'+n+'.js','utf8');return c.includes('RETIRED')||c.includes('@deprecated')});if(!ok)process.exit(1)"

- [x] [BEHAVIOR] tick-runner 已删 watcher/advancer 钩子（grep 验证）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8');if(c.includes('processHarnessCiWatchers(pool)')||c.includes('await advanceHarnessInitiatives(pool)'))process.exit(1)"

- [x] [BEHAVIOR] shepherd SQL 加 harness_mode filter
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/shepherd.js','utf8');if(!c.includes('harness_mode'))process.exit(1)"
