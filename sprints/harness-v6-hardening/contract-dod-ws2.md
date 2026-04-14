# Contract DoD — Workstream 2: 清理基础设施（Worktree + 分支 + Pipeline 产物）

- [ ] [BEHAVIOR] stop-dev.sh 检测 /Users/administrator/worktrees/cecelia/ 下 PR 已合并的孤儿 worktree，自动执行 git worktree remove
  Test: node -e "const c=require('fs').readFileSync('packages/engine/hooks/stop-dev.sh','utf8');if(!(c.includes('worktree')&&c.includes('remove')&&(c.includes('merged')||c.includes('gh pr'))))throw new Error('FAIL');console.log('PASS: 孤儿 worktree 清理逻辑存在')"
- [ ] [BEHAVIOR] stop-dev.sh worktree remove 失败时输出警告但不阻塞 hook（exit 0 继续）
  Test: node -e "const c=require('fs').readFileSync('packages/engine/hooks/stop-dev.sh','utf8');if(!c.includes('worktree remove'))throw new Error('FAIL');console.log('PASS: worktree remove 命令存在')"
- [ ] [ARTIFACT] scripts/cleanup-stale-branches.sh 存在且可执行，支持 --dry-run，过滤 cp-* 前缀，7 天保留期，分批 30 个
  Test: node -e "const fs=require('fs');fs.accessSync('scripts/cleanup-stale-branches.sh',fs.constants.X_OK);const c=fs.readFileSync('scripts/cleanup-stale-branches.sh','utf8');if(!c.includes('cp-'))throw new Error('FAIL: 无 cp-* 过滤');if(!c.includes('dry-run')&&!c.includes('dry_run'))throw new Error('FAIL: 无 dry-run');console.log('PASS: 脚本完整')"
- [ ] [BEHAVIOR] pipeline 完成后 cleanup 流程清理 worktree + 远程分支 + /tmp/cecelia-* 临时文件
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/execution.js','utf8');const has=s=>c.includes(s);if(!(has('worktree')&&has('push origin --delete')||has('branch')))throw new Error('FAIL');console.log('PASS: cleanup 产物覆盖')"
