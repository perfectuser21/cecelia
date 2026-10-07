## worktree-manage.sh cleanup 在 set -e 下首个跳过即退出（2026-10-07）

### 根本原因

- 脚本开 `set -euo pipefail`，`cmd_cleanup` 用 `((skipped++))` 计数；变量为 0 时后缀自增表达式值为 0，退出码 1，触发 set -e，在第一个未合并 worktree 处静默退出。
- 后果：本机 worktree 达 75/15 上限时，`init-or-check` 的自动清理失效，接着无法新建 worktree；只能临时 `MAX_WORKTREES=200` 绕开。同文件 `counter` 自增同样有风险。

### 下次预防

- [ ] `set -e` 脚本里计数一律写 `x=$((x + 1))`，不用 `((x++))`
- [ ] 带上限保护的自动清理路径要有"至少两个跳过项"的回归测试
