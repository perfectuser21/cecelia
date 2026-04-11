# Contract DoD — Workstream 2: Frontend — 步骤列表 + 手风琴三栏钻取视图

- [ ] [ARTIFACT] HarnessPipelineDetailPage.tsx 包含步骤列表渲染和三栏展开逻辑
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx');console.log('OK')"
- [ ] [BEHAVIOR] 组件使用 useState 管理展开状态（非注释行），包含 monospace 样式渲染
  Test: node -e "const src=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');const lines=src.split('\n').filter(l=>{const t=l.trim();return t.includes('useState')&&!t.startsWith('//')&&!t.startsWith('*')});if(lines.length===0)throw new Error('FAIL: no useState');if(!src.includes('monospace')&&!src.includes('pre>')&&!src.includes('fontFamily'))throw new Error('FAIL: no monospace');console.log('PASS: useState '+lines.length+' calls, monospace present')"
- [ ] [BEHAVIOR] 包含 "暂无数据" 占位文字和三栏标题 Input/Prompt/Output
  Test: node -e "const src=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!src.includes('暂无数据'))throw new Error('FAIL: missing placeholder');['Input','Prompt','Output'].forEach(t=>{if(!src.includes(t))throw new Error('FAIL: missing '+t)});console.log('PASS: placeholder + triple headers')"
- [ ] [BEHAVIOR] 手风琴逻辑：点击已展开步骤关闭（toggle），steps.map 遍历渲染
  Test: node -e "const src=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!src.includes('.map('))throw new Error('FAIL: no .map()');if(!/expanded.*===.*\?.*null|expanded.*===.*\?.*-1|setExpanded.*prev.*===/.test(src))throw new Error('FAIL: no toggle logic');console.log('PASS: map + accordion toggle')"
