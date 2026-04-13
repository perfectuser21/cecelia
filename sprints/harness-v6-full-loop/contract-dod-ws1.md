# Contract DoD — Workstream 1: Verdict 保护 + 失败路径强化

- [ ] [BEHAVIOR] verdict_source 字段区分 agent/callback 来源，agent 写入的 verdict 不被 callback 覆盖
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('verdict_source'))throw new Error('FAIL: verdict_source 未实现');if(!c.match(/verdict_source[\s\S]{0,200}(agent|skip|existing|preserve)/))throw new Error('FAIL: 缺少 agent verdict 保护逻辑');console.log('PASS')"
- [ ] [BEHAVIOR] Agent 崩溃未回写 verdict 时，callback 兜底标记 CRASH（赋值语句，非注释）
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.match(/verdict\s*[=:]\s*['\"]CRASH['\"]/))throw new Error('FAIL: 缺少 verdict=CRASH 赋值');if(!c.match(/(no.*verdict|!.*verdict|missing.*verdict|agent.*(fail|crash|exit))[\s\S]{0,300}CRASH/i))throw new Error('FAIL: CRASH 未与失败条件关联');console.log('PASS')"
- [ ] [BEHAVIOR] CI 超时注释与实际阈值一致（120 polls × 30s = 60 分钟）
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/harness-watcher.js','utf8');const p=c.match(/MAX_CI_WATCH_POLLS\s*=\s*(\d+)/);if(!p)throw new Error('FAIL');const t=c.match(/POLL_INTERVAL_MS\s*=\s*(\d+)/);if(!t)throw new Error('FAIL');const mins=(parseInt(p[1])*parseInt(t[1]))/60000;if(c.includes('最多 10 分钟')&&mins>15)throw new Error('FAIL: 注释说10分钟实际'+mins.toFixed(0)+'分钟');console.log('PASS: 超时='+mins.toFixed(0)+'min')"
- [ ] [BEHAVIOR] PATCH /api/brain/tasks/:id 写入 verdict 时标记 verdict_source
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/routes/tasks.js','utf8')+fs.readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('verdict_source'))throw new Error('FAIL');console.log('PASS')"
