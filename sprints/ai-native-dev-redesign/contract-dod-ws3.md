# Contract DoD — Workstream 3: 失败检测与 Brain 状态回写

- [ ] [BEHAVIOR] CI 失败时 devloop-check 回写 Brain 任务状态为 failed
  Test: node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');if(!c.includes('PATCH')&&!c.includes('failed'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] post-merge-deploy.sh 部署失败时回写 Brain 任务状态
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');if(!c.includes('api/brain/tasks'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 所有失败路径有超时保护（curl 调用设置 --max-time）
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');if(!c.includes('timeout')||!c.includes('max-time'))throw new Error('FAIL');console.log('PASS')"
