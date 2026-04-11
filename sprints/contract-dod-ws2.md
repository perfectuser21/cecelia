# Contract DoD — Workstream 2: Frontend — 详情页 + 列表导航

- [ ] [ARTIFACT] `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx` 存在且非空
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(c.length<100)throw new Error('FAIL');console.log('PASS');"
- [ ] [BEHAVIOR] 详情页路由 `/pipeline/:planner_task_id` 在 App.tsx 中以 `<Route` 声明注册
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/App.tsx','utf8');if(!c.match(/<Route[^>]*path[^>]*planner_task_id/))throw new Error('FAIL');console.log('PASS');"
- [ ] [BEHAVIOR] 列表页包含 planner 相关的导航调用（navigate+planner 或 Link+planner 组合）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelinePage.tsx','utf8');if(!(c.includes('navigate')&&c.includes('planner'))&&!c.match(/<Link[^>]*planner/))throw new Error('FAIL');console.log('PASS');"
- [ ] [BEHAVIOR] 详情页遍历渲染 stages（`.map` 调用）并引用 planner 阶段
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.match(/stages?\\.map/))throw new Error('FAIL: no stages.map');if(!c.match(/planner|Planner/i))throw new Error('FAIL: no planner');console.log('PASS');"
- [ ] [BEHAVIOR] 详情页遍历渲染 GAN rounds（`.map` 调用）并展示 verdict
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.match(/gan_rounds?\\.map|rounds?\\.map/))throw new Error('FAIL: no rounds.map');if(!c.match(/verdict/i))throw new Error('FAIL: no verdict');console.log('PASS');"
- [ ] [BEHAVIOR] 详情页在 JSX 中使用 Markdown 渲染组件（`<ReactMarkdown` 或 `<Markdown` 或 `dangerouslySetInnerHTML`）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.match(/<ReactMarkdown|<Markdown|dangerouslySetInnerHTML/))throw new Error('FAIL');console.log('PASS');"
- [ ] [BEHAVIOR] 无数据时至少 2 处降级文案在 JSX 字符串中出现（暂不可用/执行中/暂无）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');const p=[/['\"\`>]暂不可用/,/['\"\`>]执行中/,/['\"\`>]暂无/];const h=p.filter(r=>r.test(c));if(h.length<2)throw new Error('FAIL: '+h.length);console.log('PASS: '+h.length);"
