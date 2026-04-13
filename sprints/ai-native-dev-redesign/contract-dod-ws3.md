# Contract DoD — Workstream 3: 失败回写 + Deploy 触发集成

- [ ] [BEHAVIOR] devloop-check 在 harness 模式 CI 失败时，通过 curl PATCH 回写 Brain 任务状态
  Test: node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');if(!/curl[\s\S]{0,100}-X\s*PATCH[\s\S]{0,100}api\/brain\/tasks|curl[\s\S]{0,100}api\/brain\/tasks[\s\S]{0,100}PATCH/.test(c))throw new Error('FAIL: 缺少回写');if(!/harness[\s\S]{0,500}curl[\s\S]{0,100}PATCH|_harness_mode[\s\S]{0,500}curl[\s\S]{0,100}PATCH/.test(c))throw new Error('FAIL: 不在 harness 分支');console.log('PASS')"
- [ ] [BEHAVIOR] devloop-check 条件 6 merge 成功后（harness 模式）调用 post-merge-deploy.sh
  Test: node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');const mi=c.indexOf('gh pr merge');if(mi<0)throw new Error('FAIL');const after=c.substring(mi);if(!/post-merge-deploy/.test(after))throw new Error('FAIL: merge 后无部署调用');console.log('PASS')"
- [ ] [BEHAVIOR] 条件 0.5 不调用 post-merge-deploy（时序保护）
  Test: node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');const s=c.indexOf('条件 0.5');const e=c.indexOf('条件 1');if(s<0||e<0)throw new Error('FAIL: 边界未找到');if(/post-merge-deploy/.test(c.substring(s,e)))throw new Error('FAIL: 0.5 不应调用部署');console.log('PASS')"
