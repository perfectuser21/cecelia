# DoD — session 隔离根治（launcher 自动 worktree + hook 硬拦主仓写）

## ARTIFACT 条目

- [x] [ARTIFACT] `packages/engine/hooks/main-repo-write-guard.sh` 文件存在且可执行
  Test: node -e "require('fs').accessSync('packages/engine/hooks/main-repo-write-guard.sh', require('fs').constants.X_OK)"

- [x] [ARTIFACT] `packages/engine/tests/hooks/main-repo-write-guard.test.ts` 测试文件存在
  Test: node -e "require('fs').accessSync('packages/engine/tests/hooks/main-repo-write-guard.test.ts')"

- [x] [ARTIFACT] `scripts/claude-launch.sh` 含 `_in_main_repo_worktree` 判定函数
  Test: node -e "const c=require('fs').readFileSync('scripts/claude-launch.sh','utf8');if(!c.includes('_in_main_repo_worktree'))process.exit(1)"

- [x] [ARTIFACT] `scripts/claude-launch.sh` 含 `CECELIA_NO_AUTO_WORKTREE` 逃生阀
  Test: node -e "const c=require('fs').readFileSync('scripts/claude-launch.sh','utf8');if(!c.includes('CECELIA_NO_AUTO_WORKTREE'))process.exit(1)"

## BEHAVIOR 条目

- [x] [BEHAVIOR] 主仓根 + 交互模式 → `--dry-run` 输出含 `worktree add`
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [x] [BEHAVIOR] headless（-p）/ 已在 worktree / `CECELIA_NO_AUTO_WORKTREE=1` → `--dry-run` 输出不含 `worktree add`
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [x] [BEHAVIOR] 主仓根 + 交互模式（真实执行）→ 建立 session worktree、cd 进去执行、干净退出后自动清理
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [x] [BEHAVIOR] worktree 有未提交改动 → 退出后保留 worktree（不清理）；同 session_id 重启幂等复用
  Test: packages/engine/tests/launcher/claude-launch.test.ts

- [x] [BEHAVIOR] 主仓 cwd + Edit/Write/`git commit`/`git add` → hook block；只读 → 放行；worktree 内任意操作 → 放行
  Test: packages/engine/tests/hooks/main-repo-write-guard.test.ts
