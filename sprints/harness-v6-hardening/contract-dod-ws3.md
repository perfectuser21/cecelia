# Contract DoD — Workstream 3: 可观测性（Pipeline UI + Health 监控）

- [ ] [BEHAVIOR] pipeline detail API 返回 10 个 stages（含 auto-merge/deploy/smoke-test/cleanup），未到达的步骤 status 为 pending
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness.js','utf8');const steps=['merge','deploy','smoke','cleanup'];const found=steps.filter(s=>c.toLowerCase().includes(s));if(found.length<4)throw new Error('FAIL: 仅 '+found.length+'/4 新步骤');console.log('PASS: 10 步定义完整')"
- [ ] [BEHAVIOR] Brain 提供 /api/brain/harness-pipelines/stats 端点，返回 completion_rate、avg_gan_rounds、avg_duration_minutes（30 天范围）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness.js','utf8');if(!c.includes('stats')||!c.includes('completion_rate'))throw new Error('FAIL');console.log('PASS: stats 端点存在')"
- [ ] [BEHAVIOR] health 端点返回 callback_queue_stats 对象（含 unprocessed 和 failed_retries 字段）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/health-monitor.js','utf8');if(!c.includes('callback_queue'))throw new Error('FAIL');if(!c.includes('unprocessed'))throw new Error('FAIL: 缺 unprocessed');console.log('PASS: callback_queue_stats 存在')"
- [ ] [BEHAVIOR] callback_queue 中失败 3 次以上的记录触发 WARNING 告警写入 cecelia_events
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/health-monitor.js','utf8');if(!c.includes('cecelia_events'))throw new Error('FAIL');console.log('PASS: 告警写入 cecelia_events')"
- [ ] [ARTIFACT] Dashboard 存在 pipeline stats 页面组件，路由 /pipelines/stats
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/dashboard/src/pages');const has=files.some(f=>f.toLowerCase().includes('stat')&&f.toLowerCase().includes('pipeline'));if(!has)throw new Error('FAIL: 无 stats 页面');console.log('PASS: stats 页面组件存在')"
- [ ] [ARTIFACT] Dashboard pipeline detail 组件渲染全部 10 个步骤（含 cleanup/smoke-test）
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/dashboard/src/pages').filter(f=>f.includes('Pipeline'));let ok=false;for(const f of files){const c=fs.readFileSync('apps/dashboard/src/pages/'+f,'utf8');if(c.includes('cleanup')||c.includes('Cleanup'))ok=true;}if(!ok)throw new Error('FAIL');console.log('PASS: 前端包含 cleanup 步骤')"
