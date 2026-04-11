# DoD — cp-04112334-pipeline-step-detail

## Artifact

- [x] [ARTIFACT] `packages/brain/src/routes/harness.js` 返回 `steps[]` 数组（每步含 input_content/prompt_content/output_content）
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('buildSteps'))process.exit(1);if(!c.includes('getStepInput'))process.exit(1);if(!c.includes('getStepOutput'))process.exit(1);console.log('ok')"`
  
- [x] [ARTIFACT] `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 包含 StepList + ContentPanel 三栏视图
  - Test: `node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('StepList'))process.exit(1);if(!c.includes('ContentPanel'))process.exit(1);if(!c.includes('grid-cols-3'))process.exit(1);console.log('ok')"`

## Behavior

- [x] [BEHAVIOR] Backend: propose 任务从 result.propose_branch 读取分支，review 任务从 result.review_branch 读取
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!c.includes('result?.propose_branch'))process.exit(1);if(!c.includes('result?.review_branch'))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] Frontend: 点击步骤展开 Input/Prompt/Output 三栏
  - Test: `node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('input_content'))process.exit(1);if(!c.includes('prompt_content'))process.exit(1);if(!c.includes('output_content'))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] Frontend: 空内容显示"暂无数据"占位
  - Test: `node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('暂无数据'))process.exit(1);console.log('ok')"`
