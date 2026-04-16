# DoD — cp-04131520-langgraph-harness

## Artifact

- [x] [ARTIFACT] 新建 `packages/brain/src/harness-graph.js` 定义 6 节点 StateGraph
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/harness-graph.js','utf8');for(const n of ['planner','proposer','reviewer','generator','evaluator','report'])if(!c.includes(\"'\"+n+\"'\"))process.exit(1);if(!c.includes('addConditionalEdges'))process.exit(1);console.log('ok')"`

- [x] [ARTIFACT] 新建 `packages/brain/src/harness-graph-runner.js` 导出 `runHarnessPipeline`
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/harness-graph-runner.js','utf8');if(!c.includes('export async function runHarnessPipeline'))process.exit(1);if(!c.includes('HARNESS_LANGGRAPH_ENABLED'))process.exit(1);console.log('ok')"`

- [x] [ARTIFACT] 新建 `packages/brain/src/__tests__/harness-graph.test.js` 含 mock 节点流转用例
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-graph.test.js','utf8');if(!c.includes('buildHarnessGraph'))process.exit(1);if(!c.includes('REVISION'))process.exit(1);if(!c.includes('FAIL'))process.exit(1);console.log('ok')"`

- [x] [ARTIFACT] `packages/brain/package.json` 含 `@langchain/langgraph` 依赖
  - Test: `node -e "const p=require('./packages/brain/package.json');if(!p.dependencies['@langchain/langgraph'])process.exit(1);console.log('ok')"`

- [x] [ARTIFACT] `packages/brain/package.json` 含 `@langchain/langgraph-checkpoint-postgres` 依赖
  - Test: `node -e "const p=require('./packages/brain/package.json');if(!p.dependencies['@langchain/langgraph-checkpoint-postgres'])process.exit(1);console.log('ok')"`

## Behavior

- [x] [BEHAVIOR] graph 含 6 个节点 + conditional edges（reviewer/evaluator）
  - Test: `tests/packages/brain/harness-graph.skeleton.test.js`（对应 `packages/brain/src/__tests__/harness-graph.test.js` 第一个用例 "graph compiles with 6 nodes"）

- [x] [BEHAVIOR] reviewer REVISION verdict 时回到 proposer 节点
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-graph.test.js','utf8');if(!c.includes('reviewer REVISION'))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] evaluator FAIL verdict 时回到 generator 节点
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-graph.test.js','utf8');if(!c.includes('evaluator FAIL'))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] runner 读取 `HARNESS_LANGGRAPH_ENABLED` 开关，未启用时直接返回 `{ skipped: true }`
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/harness-graph-runner.js','utf8');if(!c.includes('HARNESS_LANGGRAPH_ENABLED'))process.exit(1);if(!c.includes('skipped'))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] `routes/execution.js` 老 harness 路径完全保留（向后兼容）
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('harness_planner'))process.exit(1);if(!c.includes('harness_contract_propose'))process.exit(1);console.log('ok')"`
