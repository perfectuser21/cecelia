# Contract DoD — Workstream 2: Frontend — 步骤列表 + 三栏钻取视图

- [ ] [ARTIFACT] `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 包含步骤列表和三栏视图组件
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx');console.log('OK')"
- [ ] [BEHAVIOR] 组件实际代码（排除注释）引用 steps 数组并渲染 Input/Prompt/Output 三栏，无内容时显示"暂无数据"
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');const n=c.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\{\/\*[\s\S]*?\*\/\}/g,'');if(!/steps\.map|steps\.length/.test(n))throw new Error('FAIL:steps未渲染');if(!/Input/.test(n))throw new Error('FAIL');if(!/Prompt/.test(n))throw new Error('FAIL');if(!/Output/.test(n))throw new Error('FAIL');if(!/暂无数据/.test(n))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] TypeScript 编译通过
  Test: cd apps/dashboard && npx tsc --noEmit --project tsconfig.json 2>&1 | node -e "const t=require('fs').readFileSync('/dev/stdin','utf8');if(/error TS/.test(t))throw new Error('FAIL');console.log('PASS')"
