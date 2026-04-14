contract_branch: cp-harness-contract-699c5335
workstream_index: 2
sprint_dir: sprints/harness-v6-hardening

- [x] [BEHAVIOR] Stop hook 自动清理已合并 PR 的孤儿 worktree，失败不阻塞
  Test: node -e "const fs=require('fs');let code='';try{code=fs.readFileSync('packages/engine/hooks/stop.sh','utf8')}catch(e){}try{code+=fs.readFileSync('packages/engine/hooks/stop-dev.sh','utf8')}catch(e){}if(!code)throw new Error('FAIL');if(!code.includes('worktree')||!code.includes('remove'))throw new Error('FAIL: 缺少worktree remove');if(!code.includes('||'))throw new Error('FAIL: 缺少错误处理');console.log('PASS')"
- [x] [BEHAVIOR] harness_cleanup 任务覆盖三类产物（worktree + 远程分支 + /tmp 临时文件）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/execution.js','utf8');if(!c.includes('harness_cleanup'))throw new Error('FAIL: 无harness_cleanup');if(!c.includes('worktree')||!c.includes('remove'))throw new Error('FAIL: 缺worktree清理');if(!c.includes('push origin --delete'))throw new Error('FAIL: 缺远程分支删除');if(!c.includes('/tmp/cecelia'))throw new Error('FAIL: 缺临时文件清理');console.log('PASS')"
- [x] [ARTIFACT] cleanup-stale-branches.sh 存在且包含 7 天保留期 + cp-* 过滤 + 合并检查
  Test: node -e "const code=require('fs').readFileSync('scripts/cleanup-stale-branches.sh','utf8');if(!code.includes('cp-'))throw new Error('FAIL');if(!/7\s*day|604800|7d/i.test(code))throw new Error('FAIL: 无7天保留');if(!code.includes('merge'))throw new Error('FAIL: 无合并检查');console.log('PASS')"
- [x] [ARTIFACT] cleanup-stale-branches.sh 有执行权限
  Test: node -e "const s=require('fs').statSync('scripts/cleanup-stale-branches.sh');if(!(s.mode&parseInt('111',8)))throw new Error('FAIL: 无执行权限');console.log('PASS')"
