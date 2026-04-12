# Contract DoD — Workstream 2: Frontend — 卡片布局 + 步骤详情子页面

- [ ] [ARTIFACT] 步骤详情子页面组件文件存在
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx');console.log('OK')"
- [ ] [BEHAVIOR] 卡片点击导航到 /harness-pipeline/:id/step/:step
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('cursor-pointer')||!c.includes('/step/'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 步骤详情页包含 User Input / System Prompt / Output 三栏，等宽字体，暂无数据占位
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx','utf8');if(!/User\s*Input/i.test(c)||!/System\s*Prompt/i.test(c)||!c.includes('font-mono')||!c.includes('暂无数据'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 路由 /harness-pipeline/:id/step/:step 已在 execution feature 注册
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/execution/index.ts','utf8');if(!c.includes(':step'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 步骤详情页有返回按钮可回到 Pipeline 详情页
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineStepPage.tsx','utf8');if(!/navigate/.test(c))throw new Error('FAIL');console.log('PASS')"
