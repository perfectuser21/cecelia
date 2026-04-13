# Contract DoD — Workstream 1: 部署自动化脚本

- [ ] [ARTIFACT] `scripts/post-merge-deploy.sh` 存在且可执行
  Test: node -e "const fs=require('fs');const st=fs.statSync('scripts/post-merge-deploy.sh');if(!(st.mode & 0o111))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 脚本排除注释后包含 health check 轮询（curl+循环）、Brain 重启（pm2/systemctl/brain-reload）、回退（git revert/reset）
  Test: node -e "const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/curl[^;]*health/.test(lines))throw new Error('FAIL: 无 health check');if(!/while\b|for\b/.test(lines))throw new Error('FAIL: 无循环');if(!/git\s+(revert|reset)/.test(lines))throw new Error('FAIL: 无 rollback');if(!/pm2\s+restart|systemctl\s+restart|brain-reload/.test(lines))throw new Error('FAIL: 无 restart');console.log('PASS')"
- [ ] [BEHAVIOR] Health check 超时阈值 <= 60 秒
  Test: node -e "const c=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8');const m=c.match(/(?:timeout|TIMEOUT|max_wait|MAX_WAIT|HEALTH_TIMEOUT)[^=]*=\s*(\d+)/);if(!m)throw new Error('FAIL: 无超时变量');if(parseInt(m[1])>60)throw new Error('FAIL: 超过60s');console.log('PASS: '+m[1]+'s')"
- [ ] [BEHAVIOR] Dashboard 构建在 if 条件分支内（非无条件执行）
  Test: node -e "const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/if[\s\S]{0,200}apps\/dashboard[\s\S]{0,300}(npm run build|npx vite build|pnpm.*build)/.test(lines))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 部署失败时回写 Brain 任务（curl PATCH /api/brain/tasks）
  Test: node -e "const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');if(!/curl[\s\S]{0,100}-X\s*PATCH[\s\S]{0,200}api\/brain\/tasks/.test(lines))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] Health check 通过后回写 deployed 状态，时序在 health check 之后
  Test: node -e "const lines=require('fs').readFileSync('scripts/post-merge-deploy.sh','utf8').split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');const h=lines.search(/curl[^;]*health/);const d=lines.search(/deployed|deploy_success|status.*completed/);if(h<0)throw new Error('FAIL: 无health');if(d<0)throw new Error('FAIL: 无deployed');if(d<h)throw new Error('FAIL: 时序错');console.log('PASS')"
