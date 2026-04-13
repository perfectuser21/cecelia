# Contract DoD — Workstream 1: Post-Merge 自动部署流水线

- [ ] [ARTIFACT] `scripts/post-merge-deploy.sh` 存在且可执行，包含 Brain 重启、Dashboard 部署、health gate、rollback 四大模块
  Test: node -e "const fs=require('fs');fs.accessSync('scripts/post-merge-deploy.sh',fs.constants.X_OK);const c=fs.readFileSync('scripts/post-merge-deploy.sh','utf8');if(!c.includes('brain'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 脚本支持 `--dry-run` 模式，不实际执行部署但输出将要执行的步骤
  Test: bash scripts/post-merge-deploy.sh --dry-run 2>&1 | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{if(!d.includes('dry'))throw new Error('FAIL: 无 dry-run 输出');console.log('PASS')})"
- [ ] [BEHAVIOR] Brain 变更 merge 后 health check 通过才标记部署成功，超时 30 秒后触发回退
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');if(!c.includes('health')&&!c.includes('rollback'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 部署状态写入 `/tmp/cecelia-deploy-status.json`，包含 status/timestamp/commit 字段
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');if(!c.includes('cecelia-deploy-status'))throw new Error('FAIL');console.log('PASS')"
