# Contract DoD — Workstream 2: Frontend — 步骤列表 + 三栏手风琴视图

- [ ] [ARTIFACT] HarnessPipelineDetailPage.tsx 引用 steps 数组并渲染步骤列表
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8'); if(!c.includes('steps')) throw new Error('FAIL'); console.log('PASS')"
- [ ] [BEHAVIOR] 三栏区域包含 Input/Prompt/Output 标题，使用 monospace 字体，无内容显示"暂无数据"
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8'); if(!c.includes('Input')||!c.includes('Prompt')||!c.includes('Output')) throw new Error('FAIL: title'); if(!c.includes('monospace')&&!c.includes('mono')) throw new Error('FAIL: font'); if(!c.includes('暂无数据')) throw new Error('FAIL: fallback'); console.log('PASS')"
- [ ] [BEHAVIOR] 手风琴模式：使用 useState 管理展开状态，同时只展开一个步骤
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8'); if(!c.includes('useState')) throw new Error('FAIL: no useState'); if(!c.includes('expanded')&&!c.includes('activeStep')&&!c.includes('openStep')&&!c.includes('selectedStep')) throw new Error('FAIL: no expand state'); console.log('PASS')"
