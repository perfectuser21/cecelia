# Contract DoD — Workstream 1: SKILL.md v5.0 全量升级

- [ ] [ARTIFACT] `packages/workflows/skills/harness-planner/SKILL.md` 存在且 frontmatter `version:` 行值为 `5.0.0`
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/^version:\s*(.+)$/m);if(!m||m[1].trim()!=='5.0.0'){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] Step 0 区域内包含 Brain API 三端点（/api/brain/context、/api/brain/tasks、/api/brain/decisions）+ 边界声明
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const m=c.match(/Step\s*0[\s\S]*?(?=Step\s*1)/i);if(!m){console.error('FAIL:no Step 0');process.exit(1)}const s=m[0];const a=['/api/brain/context','/api/brain/tasks','/api/brain/decisions'];const miss=a.filter(x=>!s.includes(x));if(miss.length){console.error('FAIL:'+miss);process.exit(1)}if(!['不读代码实现','不读实现细节','不探索代码实现'].some(p=>s.includes(p))){console.error('FAIL:no boundary');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 6 个结构化元素（User Stories + 同段落 GWT + FR-编号 + SC-编号 + 假设标题 + 边界标题）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('\u6267\u884c\u6d41\u7a0b');if(idx===-1){process.exit(1)}const t=c.substring(idx);if(!/User Stor/.test(t)||!/FR-\d{3}/.test(t)||!/SC-\d{3}/.test(t)||!/假设|显式假设/.test(t)||!/边界/.test(t)){process.exit(1)}const ps=t.split(/\n\s*\n/);if(!ps.some(p=>/Given/.test(p)&&/When/.test(p)&&/Then/.test(p))){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 9 类歧义自检 + ASSUMPTION 标记 + 方向性决策原则
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('\u6267\u884c\u6d41\u7a0b');if(idx===-1){process.exit(1)}const t=c.substring(idx);const k=['功能范围','数据模型','UX','非功能需求','集成点','边界','约束','术语','完成信号'];if(k.some(x=>!t.includes(x))){process.exit(1)}if(!t.includes('ASSUMPTION')||!t.includes('方向性')){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 执行流程区域内包含 OKR 对齐章节（KR + 进度 + 推进）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');const idx=c.indexOf('\u6267\u884c\u6d41\u7a0b');if(idx===-1){process.exit(1)}const t=c.substring(idx);if(!t.includes('OKR 对齐')||!t.includes('KR')||!t.includes('进度')||!t.includes('推进')){process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 不包含用户交互占位符（请用户确认/待用户回答/等待用户）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(['请用户确认','待用户回答','等待用户'].some(x=>c.includes(x))){process.exit(1)}console.log('PASS')"
