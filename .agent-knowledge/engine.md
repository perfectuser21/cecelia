# Cecelia 开发工具

Engine 独立包已退役。开发工具归根脚本，执行 adapter 归运行组件；没有 Engine 独立版本、六文件 bump 或 `[CONFIG]` 提交要求。

| 能力 | 归属 | 验证 |
|---|---|---|
| 分支、Bash、dev-mode、主仓写入守卫 | `scripts/dev/hooks/` | 同目录 `__tests__` 的真实 stdin/Git/receipt 回归 |
| 共享 hook 函数 | `scripts/dev/lib/hook-utils.sh` | hook 合同行为 |
| worktree 与 guardian | `scripts/dev/worktree/` | `scripts/dev/__tests__` 私有 Git/FD201/清理回归 |
| Claude launcher | `scripts/claude-launch.sh` | `scripts/dev/__tests__` 私有 HOME/argv/cwd 回归 |
| 旧 codex_dev adapter | `packages/brain/scripts/codex-bridge/` | Brain runner/bridge 回归 |
| DoD 映射 | `scripts/devgate/check-dod-mapping.cjs` | 根 CI 的实际 CLI 回归 |
| Skills 正文 | `zenithjoy-skills` 中心仓 | 固定来源恢复、所有权与合同 |

`hooks` 是到 `scripts/dev/hooks` 的兼容符号链接；安装器使用新 owner，不依赖旧包。运行 `node scripts/dev/check.mjs`，主 CI 的 scripts 组件会执行同一入口。缺测试集合、脚本语法错误或真实子进程失败均返回非零。测试只操作私有 fixture；不得用生产 Brain 验证测试效果。
