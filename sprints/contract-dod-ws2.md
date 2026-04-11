# Contract DoD — Workstream 2: Frontend — 步骤列表 + 三栏钻取视图

- [ ] [ARTIFACT] `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 包含步骤列表和三栏视图组件
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx');console.log('OK')"
- [ ] [BEHAVIOR] 组件代码引用 steps 数组并渲染 Input/Prompt/Output 三栏，无内容时显示"暂无数据"
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!/steps/.test(c))throw new Error('FAIL:no steps');if(!/Input/.test(c))throw new Error('FAIL:no Input');if(!/Prompt/.test(c))throw new Error('FAIL:no Prompt');if(!/Output/.test(c))throw new Error('FAIL:no Output');if(!/暂无数据/.test(c))throw new Error('FAIL:no placeholder');console.log('PASS')"
- [ ] [BEHAVIOR] TypeScript 编译通过
  Test: cd apps/dashboard && npx tsc --noEmit --project tsconfig.json 2>&1 | node -e "const t=require('fs').readFileSync('/dev/stdin','utf8');if(/error TS/.test(t))throw new Error('FAIL:TS errors');console.log('PASS')"
