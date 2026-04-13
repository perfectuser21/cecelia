# Contract DoD — Workstream 1: Post-Merge Deploy 脚本

- [ ] [ARTIFACT] scripts/post-merge-deploy.sh 存在且可执行
  Test: node -e "const fs=require('fs');fs.accessSync('scripts/post-merge-deploy.sh',fs.constants.X_OK);console.log('PASS')"
- [ ] [BEHAVIOR] --dry-run 模式生成 /tmp/cecelia-deploy-status.json，含 status/timestamp/commit 字段
  Test: bash -c "rm -f /tmp/cecelia-deploy-status.json && bash scripts/post-merge-deploy.sh --dry-run 2>/dev/null; node -e \"const s=JSON.parse(require('fs').readFileSync('/tmp/cecelia-deploy-status.json','utf8'));if(!s.status||!s.timestamp||!s.commit)throw new Error('FAIL');console.log('PASS: '+s.status)\""
- [ ] [BEHAVIOR] 脚本包含 curl health 循环轮询 + git revert 回退 + Brain 重启命令的完整部署链路
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');if(!/curl[^;]*health/.test(c))throw new Error('FAIL: 无 curl health');if(!/while\b|for\b/.test(c))throw new Error('FAIL: 无循环');if(!/git\s+(revert|reset)/.test(c))throw new Error('FAIL: 无 rollback');if(!/pm2\s+restart|systemctl\s+restart|brain-reload|pkill.*node/.test(c))throw new Error('FAIL: 无重启');console.log('PASS')"
- [ ] [BEHAVIOR] Dashboard 构建仅在检测到 apps/dashboard 变更时条件触发
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');if(!/apps\/dashboard/.test(c))throw new Error('FAIL: 无路径检测');if(!/npm run build|npx vite build|pnpm.*build/.test(c))throw new Error('FAIL: 无构建命令');console.log('PASS')"
- [ ] [BEHAVIOR] 部署失败时通过 curl PATCH 回写 Brain 任务状态
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');if(!/curl[\s\S]{0,100}PATCH[\s\S]{0,100}api\/brain\/tasks|curl[\s\S]{0,100}api\/brain\/tasks[\s\S]{0,100}PATCH/.test(c))throw new Error('FAIL');console.log('PASS')"
