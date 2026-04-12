# Contract DoD — Workstream 1: SKILL.md v5.0 全量升级

- [ ] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 存在且 frontmatter `version:` 行值为 `5.0.0`
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/^version:\s*(.+)$/m);if(!m||m[1].trim()!=='5.0.0'){console.error('FAIL: version='+((m&&m[1])||'missing'));process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内 Step 0 包含 `curl localhost:5221/api/brain/context` 且包含"不读代码实现"边界声明
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('执行流程');if(idx===-1){console.error('NO 执行流程');process.exit(1)}const f=c.substring(idx);if(!f.includes('curl localhost:5221/api/brain/context')){console.error('FAIL: no Brain API in flow');process.exit(1)}if(!f.includes('不读代码实现')&&!f.includes('不读实现细节')&&!f.includes('不探索代码实现')){console.error('FAIL: no boundary');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 User Stories + Given-When-Then + FR-编号 + SC-编号 + 假设 + 边界 6 个结构化章节
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('执行流程');if(idx===-1){console.error('NO 执行流程');process.exit(1)}const t=c.substring(idx);const r=[/User Stor/,/Given.*When.*Then/s,/FR-\d{3}/,/SC-\d{3}/,/假设/,/边界/];let f=0;r.forEach((x,i)=>{if(!x.test(t)){console.error('MISS:'+i);f=1}});if(f)process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含"范围限定"和"受影响文件"章节
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('执行流程');if(idx===-1){console.error('NO 执行流程');process.exit(1)}const t=c.substring(idx);if(!/范围限定|在范围.*不在范围|不在范围.*在范围/s.test(t)){console.error('MISS: 范围限定');process.exit(1)}if(!/受影响文件|影响.*文件/.test(t)){console.error('MISS: 受影响文件');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 包含 9 类歧义自检列表 + `[ASSUMPTION: ...]` 标记 + "方向性"决策提问原则
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const k=['功能范围','数据模型','UX','非功能需求','集成点','边界','约束','术语','完成信号'];let m=k.filter(x=>!c.includes(x));if(m.length>0){console.error('MISS:'+m);process.exit(1)}if(!c.includes('ASSUMPTION')){console.error('NO ASSUMPTION');process.exit(1)}if(!c.includes('方向性')){console.error('NO 方向性');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板包含 `## OKR 对齐` 章节，含 KR + 进度 + 推进三字段
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('OKR 对齐')){console.error('NO OKR');process.exit(1)}if(!c.includes('KR')||!c.includes('进度')||!c.includes('推进')){console.error('INCOMPLETE');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板不包含任何用户交互占位符（`请用户确认`/`待用户回答`/`等待用户`）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');['请用户确认','待用户回答','等待用户'].forEach(x=>{if(c.includes(x)){console.error('FOUND:'+x);process.exit(1)}});console.log('PASS')"
