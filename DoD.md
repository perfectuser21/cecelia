# DoD — Stop Hook 会话隔离修复

## 分支
cp-04092219-fix-stop-hook-session

## 验收条目

- [x] [ARTIFACT] worktree-manage.sh 版本头更新为 v1.4.0
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/scripts/worktree-manage.sh','utf8');if(!c.includes('v1.4.0'))process.exit(1)"

- [x] [BEHAVIOR] worktree-manage.sh cmd_create() 在 git worktree add 成功后写入 .dev-lock.BRANCH
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/scripts/worktree-manage.sh','utf8');if(!c.includes('.dev-lock.\${branch_name}'))process.exit(1)"

- [x] [BEHAVIOR] .dev-lock 内容包含 tty 字段（非空占位）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/scripts/worktree-manage.sh','utf8');if(!c.includes('tty: $(tty'))process.exit(1)"

- [x] [BEHAVIOR] .dev-lock 内容包含 session_id 字段（CLAUDE_SESSION_ID）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/scripts/worktree-manage.sh','utf8');if(!c.includes('CLAUDE_SESSION_ID'))process.exit(1)"
