# DoD: flip default LangGraph flags + 删 fallback gate

- [x] [BEHAVIOR] dispatcher.js: 无 env flag 时 dev 任务走 v2 workflow runtime
  Test: packages/brain/src/__tests__/dispatcher-default-graph.test.js

- [x] [BEHAVIOR] executor.js: 无 env flag 时 harness_planner 走 LangGraph Pipeline
  Test: packages/brain/src/__tests__/executor-default-langgraph.test.js

- [x] [BEHAVIOR] executor.js: 无 env flag 时 harness_initiative 走 full graph
  Test: packages/brain/src/__tests__/executor-harness-initiative-default-fullgraph.test.js

- [x] [ARTIFACT] dispatcher.js 不再含 WORKFLOW_RUNTIME 检查
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/dispatcher.js','utf8');if(c.includes('WORKFLOW_RUNTIME'))process.exit(1)"

- [x] [ARTIFACT] executor.js 不再含 HARNESS_LANGGRAPH_ENABLED 检查
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(c.includes('HARNESS_LANGGRAPH_ENABLED'))process.exit(1)"

- [x] [ARTIFACT] executor.js 不再含 HARNESS_USE_FULL_GRAPH 检查
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(c.includes('HARNESS_USE_FULL_GRAPH'))process.exit(1)"

- [x] [ARTIFACT] harness-graph-runner.js 不再含 isLangGraphEnabled
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-graph-runner.js','utf8');if(c.includes('isLangGraphEnabled'))process.exit(1)"
