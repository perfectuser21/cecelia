contract_branch: cp-harness-contract-699c5335
workstream_index: 3
sprint_dir: sprints/harness-v6-hardening

- [x] [BEHAVIOR] harness.js pipeline-detail 包含完整 10 步定义
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');const steps=['planner','propose','review','generate','evaluate','report','auto.merge','deploy','smoke.test','cleanup'];const missing=steps.filter(s=>!new RegExp(s.replace('.','[_\\\\-\\\\.]?'),'i').test(code));if(missing.length>0)throw new Error('FAIL: 缺少步骤: '+missing.join(', '));console.log('PASS')"
- [x] [BEHAVIOR] stats 端点包含 completion_rate + avg_gan_rounds + avg_duration 三字段和 SQL 聚合
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!code.includes('completion_rate'))throw new Error('FAIL');if(!code.includes('avg_gan_rounds'))throw new Error('FAIL');if(!code.includes('avg_duration'))throw new Error('FAIL');if(!/SELECT|COUNT|AVG/i.test(code))throw new Error('FAIL: 缺SQL聚合');console.log('PASS')"
- [x] [BEHAVIOR] health-monitor 返回 callback_queue_stats 对象含 unprocessed + failed_retries，查询 callback_queue 表
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/health-monitor.js','utf8');if(!code.includes('callback_queue_stats'))throw new Error('FAIL');if(!/SELECT.*callback_queue|FROM.*callback_queue/i.test(code))throw new Error('FAIL: 缺SQL查询');if(!code.includes('unprocessed'))throw new Error('FAIL');if(!code.includes('failed_retries'))throw new Error('FAIL');console.log('PASS')"
- [x] [BEHAVIOR] 前端 pipeline 组件包含 cleanup/smoke-test 步骤渲染
  Test: node -e "const{execSync}=require('child_process');const fs=require('fs');const raw=execSync('find apps/dashboard/src -name \"*ipeline*\" -o -name \"*pipeline*\"').toString().trim().split('\n').filter(Boolean);const files=raw.filter(f=>fs.statSync(f).isFile());if(!files.length)throw new Error('FAIL');let ok=false;for(const f of files){const c=fs.readFileSync(f,'utf8');if(c.includes('cleanup')||c.includes('Cleanup')||c.includes('smoke'))ok=true}if(!ok)throw new Error('FAIL');console.log('PASS')"
- [x] [BEHAVIOR] 前端 stats 页面展示 completionRate 和 GAN 轮次
  Test: node -e "const{execSync}=require('child_process');const fs=require('fs');const raw=execSync('find apps/dashboard/src -name \"*pipeline*\" -o -name \"*Pipeline*\"').toString().trim().split('\n').filter(Boolean);const sf=raw.filter(f=>fs.statSync(f).isFile()).filter(f=>f.toLowerCase().includes('stat'));if(!sf.length)throw new Error('FAIL: 无stats页面');const code=fs.readFileSync(sf[0],'utf8');if(!code.includes('completion_rate')&&!code.includes('completionRate'))throw new Error('FAIL');if(!code.includes('avg_gan')&&!code.includes('avgGan')&&!code.includes('ganRounds'))throw new Error('FAIL');console.log('PASS')"
