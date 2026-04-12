# Contract DoD — Workstream 3: stop.sh Worktree 检测修复

- [ ] [BEHAVIOR] stop.sh 在遍历 worktree 列表时，对每个路径执行 `-d` 目录存在性检查，跳过已删除的 worktree
  Test: node -e "const c=require('fs').readFileSync('packages/engine/hooks/stop.sh','utf8');if(!c.includes('-d'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] stop-dev.sh 与 stop.sh 使用一致的 worktree 存在性检测逻辑
  Test: node -e "try{const c=require('fs').readFileSync('packages/engine/hooks/stop-dev.sh','utf8');if(c.includes('worktree')&&!c.includes('-d'))process.exit(1);console.log('PASS')}catch(e){if(e.code==='ENOENT')console.log('PASS: no stop-dev.sh');else throw e}"
