# Stop Hook 孤儿 worktree 清理：locked worktree 假成功日志修复

## 背景
`packages/engine/hooks/stop.sh` 第80-118行的孤儿 worktree 自动清理逻辑，对已合并 PR 的孤儿 worktree 尝试删除。当 worktree 处于 git-level `locked` 状态时，`git worktree remove --force`（单个 `--force`）必然失败（沙箱实测：exit 128, `cannot remove a locked working tree; use 'remove -f -f' to override or unlock first`）。但脚本删除失败后无条件打印 `[Stop Hook] 已清理已合并 PR 孤儿 worktree` 成功日志，未检查真实退出码。触发案例：`.worktrees/impact-contract-fix`（分支 `cp-08110022-internal-auth-sidecar`，PR 已合并，因 locked 永远清不掉且每次 Stop 事件都误报"已清理"）。

## 方案（已与用户确认，PrepPRD 阶段拍板）
删除前先 `git worktree unlock <path>`（忽略失败——非 locked 的 worktree unlock 本就会失败，属正常路径）；再用 `git worktree remove --force --force`（双 `--force`，同时覆盖 dirty 检查和 lock 检查）执行真正删除。

日志逻辑改为 if/else：
- remove 命令退出码为 0 → 打印"已清理已合并 PR 孤儿 worktree"
- 非 0 → 打印"worktree remove 失败（已忽略）"，**不再**紧跟打印虚假成功日志

## 备选方案（未采用）
- 仅 `--force --force` 不先 unlock：能达到同样效果（`--force --force` 本身已覆盖 lock），但保留 `unlock` 步骤使锁状态在 git 内部元数据里也变得干净（`git worktree list` 不再显示 `locked` 残留标记的边界情况更少），且更贴近"先温和后强制"的一贯风格。两者功能等价，选保留 unlock 步骤是防御性写法，非必需。
- 仅判断 `stop_hook_should_skip_worktree` 增加"locked 也跳过"分支：被否决——这会让已合并 PR 的 locked worktree 永久跳过清理（治标不治本，锁不解开问题永远在）。

## 影响范围
仅 `packages/engine/hooks/stop.sh` 单个代码块（第80-118行区间的孤儿清理子逻辑）。不影响 `stop_hook_should_skip_worktree`（`lib/worktree-guard.sh`）的判定逻辑——那部分（跳过 dirty/active-lock）本身正确，不在本次修复范围。

## 测试策略
纯逻辑接缝（bash + git 命令行为），CI test 就够：
新建 `packages/engine/hooks/tests/stop-orphan-cleanup-locked.test.sh`：
1. 建临时 git repo + worktree，`git worktree lock` 锁住，制造一个"已合并 PR"场景（mock `gh` 或直接抽取清理逻辑为可测函数，用 fixture 分支模拟已合并状态）
2. 跑清理逻辑（抽取成可 source 的函数，与 `lib/worktree-guard.sh` 同等做法，避免整份 stop.sh 难以单测）
3. 断言：① worktree 真正从 `git worktree list` 消失 ② 清理成功日志只出现在真实成功时，不会在失败路径下出现

## 顺带发现，不在本次范围内
`packages/engine/skills/dev/scripts/worktree-manage.sh` 的 `cmd_cleanup`（第501-543行）有同类"忽略失败继续"设计，且 `((cleaned++))`/`((skipped++))` 在计数器为 0 时因 bash 算术求值语义在 `set -euo pipefail` 下会触发脚本提前退出（经手动复现：只处理第一条记录就无声中止）。这是一个独立 bug，会导致该脚本的 worktree 上限自动清理长期失效（今天创建本任务 worktree 时撞到 15/15 上限，cleanup 卡死，靠手动清一个空 worktree + 临时调高 `MAX_WORKTREES` 绕过）。留给下一个任务单独修，不在本 PR 混改。
