# Contract DoD — Workstream 1: SKILL.md 全面升级

- [ ] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 文件存在且 version 字段为 5.x.x
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!/version:\s*5\.\d+\.\d+/.test(c)){console.log('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] Step 0 包含 Brain API 三端点调用指令（/api/brain/context、/api/brain/tasks、/api/brain/decisions）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const apis=['/api/brain/context','/api/brain/tasks','/api/brain/decisions'];const missing=apis.filter(a=>!c.includes(a));if(missing.length){console.log('FAIL: missing '+missing.join(', '));process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板包含 User Stories 章节、Given-When-Then 验收场景、FR-xxx 功能需求编号、SC-xxx 成功标准编号
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const checks=['User Stor','Given','When','Then','FR-','SC-'];const missing=checks.filter(k=>!c.includes(k));if(missing.length){console.log('FAIL: missing '+missing.join(', '));process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板包含假设列表章节和边界情况章节
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('假设')){console.log('FAIL: no assumptions');process.exit(1)}if(!c.includes('边界')){console.log('FAIL: no edge cases');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 包含 ASSUMPTION 标记格式和至少 5 类歧义扫描类目
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('ASSUMPTION')){console.log('FAIL: no ASSUMPTION marker');process.exit(1)}const cats=['功能范围','数据模型','非功能','边界','完成信号'];const found=cats.filter(x=>c.includes(x)).length;if(found<5){console.log('FAIL: only '+found+'/5 categories');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] PRD 模板包含 OKR 对齐章节
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.includes('OKR')|| !c.includes('对齐')){console.log('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 不包含超过 2 处向用户提问的指令
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=(c.match(/向用户(提问|询问|确认)/g)||[]).length;if(m>2){console.log('FAIL: '+m+' ask-user patterns');process.exit(1)}console.log('PASS: '+m+' ask-user patterns')"
