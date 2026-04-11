# Contract DoD — Workstream 2: Frontend — Pipeline 详情页 + 导航

- [ ] [ARTIFACT] 详情页组件文件存在且可被路由加载
  Test: node -e "require('fs').accessSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx'); console.log('OK')"
- [ ] [BEHAVIOR] 详情页路由 /harness-pipeline/:planner_task_id 已注册
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/execution/index.ts','utf8'); if(!c.includes(':planner_task_id')) throw new Error('FAIL'); console.log('PASS')"
- [ ] [BEHAVIOR] 列表页点击 Pipeline 卡片导航到详情页
  Test: node -e "const fs=require('fs'); const files=['apps/api/features/execution/pages/HarnessPipelinePage.tsx','apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx']; for(const f of files){try{const c=fs.readFileSync(f,'utf8'); if(c.includes('navigate')||c.includes('Link')){console.log('PASS: '+f); process.exit(0);}}catch(e){}} throw new Error('FAIL')"
- [ ] [BEHAVIOR] 详情页展示 6 步阶段时间线（Planner/Propose/Review/Generate/Evaluate/Report）
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx','utf8'); const hits=['planner','propose','review','generat','evaluat','report'].filter(s=>c.toLowerCase().includes(s)); if(hits.length<4) throw new Error('FAIL: only '+hits.length); console.log('PASS: '+hits.length+'/6')"
- [ ] [BEHAVIOR] GAN 对抗轮次按 R1/R2/R3 展示 DOD 草稿和 verdict
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx','utf8'); if(!c.includes('round')&&!c.includes('Round')) throw new Error('FAIL: no round'); if(!c.includes('verdict')&&!c.includes('Verdict')) throw new Error('FAIL: no verdict'); console.log('PASS')"
- [ ] [BEHAVIOR] 无 GAN 数据时显示占位文案，不报错
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx','utf8'); if(!c.includes('暂无')&&!c.includes('暂不可用')) throw new Error('FAIL: no fallback text'); console.log('PASS')"
- [ ] [BEHAVIOR] PRD 内容使用 Markdown 渲染
  Test: node -e "const c=require('fs').readFileSync('apps/api/features/execution/pages/HarnessPipelineDetailPage.tsx','utf8'); if(!c.match(/markdown|Markdown|ReactMarkdown|marked|remark|dangerouslySetInnerHTML/i)) throw new Error('FAIL'); console.log('PASS')"
