# 小改动 PrepPRD：claude-launch.sh 把 per-session worktree 的 projects 目录软链回主仓，修复 /resume 历史被打散

## 改什么
`scripts/claude-launch.sh`（cecelia 主仓）：在自动建立 per-session worktree 并 cd 进去之后、启动 claude 之前，增加一步：

1. 由 worktree 路径计算 Claude Code 的 projects key（路径里 `/` 和 `.` 替换为 `-`，如 `/Users/administrator/worktrees/cecelia/session-539a4744` → `-Users-administrator-worktrees-cecelia-session-539a4744`）
2. 由主仓路径计算主仓 projects key（如 `-Users-administrator-perfect21-cecelia`），`mkdir -p` 确保存在
3. 在 `~/.claude/projects/`（真实目录，各账号 projects 已软链到这里）创建软链：`<session-key>` → `<main-repo-key>`
4. 若 session-key 位置已存在**真实目录**（历史遗留孤儿），先把其中 `*.jsonl` 及 session 子目录搬进主仓文件夹，再替换为软链；已是软链则跳过
5. 干净退出清理 worktree 时，同步删除该软链本身（`rm` 软链，绝不 `rm -rf` 跟随进主仓文件夹）

通用化：projects key 从 `$_MAIN_REPO` / `$_WT_PATH` 动态计算，不写死 cecelia——zenithjoy 走同一个 launcher 时天然覆盖。

## 为什么改
PR #3557 session 隔离后每个交互 session 落独立 cwd，Claude Code 按 cwd 分项目文件夹存会话记录，`/resume` 按当前 cwd 过滤 → 只能看到当前 session 自己，全部历史不可见，且每个会话产生一个孤儿文件夹。软链让所有会话记录继续汇聚主仓池子（与跨账号共享同一机制），`/resume` 恢复完整历史，per-session memory 目录也随之统一。

## 关联上下文
- 相关 PR：#3557（session 隔离根治）
- Brain Task：6e155270-47e0-46d2-af72-be98cf6814ca
- 相关 Journey：Cecelia Harness Pipeline（bb8cc561）
- 历史决策匹配：无冲突（decisions/match 返回空）

## 影响范围
- 只影响交互模式 + 自动 worktree 路径；headless（cecelia-run.sh）、逃生阀 `CECELIA_NO_AUTO_WORKTREE=1`、已在 worktree 内启动的场景行为不变
- 软链指向 `~/.claude/projects/` 真实目录，三账号共享不受影响
- 风险点：清理逻辑必须只删软链本身，不得触及主仓项目文件夹内容

## 哨兵（回归守卫）
- 逻辑接缝：key 计算 / 软链创建 / 孤儿目录迁移 → CI test（bats 或 bash 断言脚本，用 mktemp 沙箱模拟 HOME）
- proven-to-fire：测试先写、先看红（TDD commit-1）

## 验收标准
- [ ] CI test：给定 worktree 路径，脚本生成正确 projects key 并创建软链指向主仓 key（沙箱 HOME 验证）
- [ ] CI test：session-key 位置已存在含 .jsonl 的真实目录时，文件被迁移进主仓文件夹且原位变软链
- [ ] CI test：干净退出清理后软链被移除，主仓文件夹内 .jsonl 完好
- [ ] 手工验证：新开 claude session，`~/.claude/projects/` 下新 session key 是软链；transcript 落在主仓文件夹
- [ ] CI 全绿
