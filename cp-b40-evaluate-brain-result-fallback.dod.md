# DoD: B40 evaluateContractNode .brain-result.json Fallback

**Branch**: cp-b40-evaluate-brain-result-fallback  
**PR**: TBD  
**Date**: 2026-05-15

---

## 成功标准

- [x] [ARTIFACT] `packages/brain/src/workflows/harness-task.graph.js` 导入 `readBrainResult`
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes('readBrainResult'))process.exit(1);console.log('OK')"`

- [x] [ARTIFACT] Protocol v2.5 fallback 代码块存在于 `harness-task.graph.js`（`readVerdictFile` 之后、Protocol v1 之前）
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.includes('Protocol v2.5'))process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] `.brain-result.json` verdict=PASS → `evaluate_verdict` 返回 PASS（B40 unit test Case 1）
  - Test: `tests:packages/brain/src/workflows/__tests__/harness-task-b40-brain-result-fallback.test.js`

- [x] [BEHAVIOR] `.brain-result.json` verdict=FAIL → `evaluate_verdict` 返回 FAIL + `evaluate_error` 含 log（B40 unit test Case 2）
  - Test: `tests:packages/brain/src/workflows/__tests__/harness-task-b40-brain-result-fallback.test.js`

- [x] [BEHAVIOR] `.brain-result.json` 不存在 → `readBrainResult` 抛异常被 catch，继续 Protocol v1 stdout fallback（B40 unit test Case 3）
  - Test: `tests:packages/brain/src/workflows/__tests__/harness-task-b40-brain-result-fallback.test.js`

- [x] [BEHAVIOR] `readBrainResult` 调用被 try-catch 包裹（防止文件缺失时崩溃）
  - Test: `tests:packages/brain/src/workflows/__tests__/harness-task-b40-brain-result-fallback.test.js`
