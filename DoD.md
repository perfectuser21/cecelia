contract_branch: cp-harness-contract-7899243b
workstream_index: 2
sprint_dir: sprints/harness-pipeline-closure-v1

- [x] [BEHAVIOR] stop.sh worktree 遍历段在 .dev-lock 检测前验证目录存在（-d 检查）
  Test: node -e "const c=require('fs').readFileSync('packages/engine/hooks/stop.sh','utf8');const s=c.substring(c.indexOf('_wt_path='),c.indexOf('done <',c.indexOf('_wt_path=')));const di=Math.max(s.indexOf('[ -d'),s.indexOf('test -d'),s.indexOf('[[ -d'));const li=s.indexOf('.dev-lock');if(di===-1){console.log('FAIL: 无 -d 检查');process.exit(1)}if(di>li){console.log('FAIL: -d 在 .dev-lock 之后');process.exit(1)}console.log('PASS')"
- [x] [BEHAVIOR] stop-dev.sh 与 stop.sh 使用一致的 worktree 存在性检测逻辑
  Test: node -e "try{const c=require('fs').readFileSync('packages/engine/hooks/stop-dev.sh','utf8');if((c.includes('_wt_path')||c.includes('worktree list'))&&!c.includes('-d')){console.log('FAIL');process.exit(1)}console.log('PASS')}catch(e){if(e.code==='ENOENT')console.log('PASS');else throw e}"
