# DoD — Harness Pipeline Brain Fixes

- [x] [ARTIFACT] `packages/brain/src/task-router.js` 包含 harness_evaluate 同时在 VALID_TASK_TYPES 和 LOCATION_MAP 中
- [x] [BEHAVIOR] Fix 1 unit test 通过：`manual:node -e "import('./packages/brain/src/task-router.js').then(m=>{if(!m.isValidTaskType('harness_evaluate'))process.exit(1);if(m.getTaskLocation('harness_evaluate')!=='us')process.exit(1);console.log('ok')})"`
- [x] [ARTIFACT] `packages/brain/src/workflows/harness-initiative.graph.js` runPlannerNode prompt 含 PrepPRD 章节，env 含 CECELIA_JOURNEY_ID
- [x] [BEHAVIOR] Fix 2+3 unit tests 通过（harness-initiative.graph.full.test.js 5 个新 case 全绿）：`tests:packages/brain/src/workflows/__tests__/harness-initiative.graph.full.test.js`
