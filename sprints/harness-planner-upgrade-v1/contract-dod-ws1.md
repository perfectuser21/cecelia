# Contract DoD — Workstream 1: SKILL.md v5.0 全量升级

- [ ] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 存在且 frontmatter `version:` 行值为 `5.0.0`
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/^version:\s*(.+)$/m);if(!m||m[1].trim()!=='5.0.0'){console.error('FAIL: version='+((m&&m[1])||'missing'));process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] Step 0 区域包含 `curl localhost:5221/api/brain/context` 且包含"不读代码实现"边界声明
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const s0=c.indexOf('Step 0');const s1=c.indexOf('Step 1',s0>-1?s0+1:0);if(s0===-1){process.exit(1)}const t=c.substring(s0,s1>s0?s1:undefined);if(!t.includes('curl localhost:5221/api/brain/context')){process.exit(1)}if(!t.includes('不读代码实现')&&!t.includes('不读实现细节')&&!t.includes('不探索代码实现')){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 User Stories 标题 + Given-When-Then（200字符内） + FR-编号 + SC-编号 + 假设标题 + 边界标题
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const t=c.substring(c.indexOf('执行流程'));const r=[[/#{2,3}\s*User Stor/m,'UserStories'],[/Given[\s\S]{0,200}When[\s\S]{0,200}Then/,'GWT'],[/FR-\d{3}/,'FR'],[/SC-\d{3}/,'SC'],[/#{2,3}\s*.*假设/m,'假设'],[/#{2,3}\s*.*边界/m,'边界']];let f=0;r.forEach(([x,n])=>{if(!x.test(t)){console.error('MISS:'+n);f=1}});if(f)process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] 包含 9 类歧义自检列表 + `[ASSUMPTION:` 方括号格式 + "方向性"决策提问原则
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const k=['功能范围','数据模型','UX','非功能需求','集成点','边界','约束','术语','完成信号'];let m=k.filter(x=>!c.includes(x));if(m.length>0){console.error('MISS:'+m);process.exit(1)}if(!/\[ASSUMPTION:/.test(c)){console.error('NO [ASSUMPTION:');process.exit(1)}if(!c.includes('方向性')){console.error('NO 方向性');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 `OKR 对齐` 标题，含 KR + 进度 + 推进三字段
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const t=c.substring(c.indexOf('执行流程'));if(!/#{2,3}\s*OKR 对齐/m.test(t)){console.error('NO OKR title');process.exit(1)}if(!t.includes('KR')||!t.includes('进度')||!t.includes('推进')){console.error('INCOMPLETE');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板不包含任何用户交互占位符（`请用户确认`/`待用户回答`/`等待用户`）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');['请用户确认','待用户回答','等待用户'].forEach(x=>{if(c.includes(x)){console.error('FOUND:'+x);process.exit(1)}});console.log('PASS')"
