# Worktree 隔离防护 Gate — 设计文档

- 日期：2026-06-02
- 分支：cp-0602144035-worktree-isolation-gate
- 关联 Issue：bfeec6d6-87b8-42b8-8208-da0ddfa169cf
- 关联 Journey：J8 · /dev 开发流水线（27e83eb4-d582-4baf-aa08-7d6acbbe6e26）
- 类型：Bug fix / `[CONFIG]`（改 packages/engine/hooks + skills）

## 问题

主仓库目录 `/Users/administrator/perfect21/cecelia` 被多个 cp-* 任务用 `git checkout` 当共享开发工作台（reflog 05-31~06-02 上午一长串 checkout 为证），绕过 worktree 隔离。两个任务在主仓库并发时（一个 rebase、一个 checkout main 提交），工作目录被互相抽走 → git 操作踩踏。PR 3226 合并时"主目录莫名被切到 main"即此。

## 现有防线为何失效

`packages/engine/hooks/branch-protect.sh` 行 134-149 已有"主仓库 cp-* 分支禁开发"检查，但拦不住，因为：

1. **触发器缝隙**：branch-protect 只在 `Write|Edit` PreToolUse 触发（settings.json）。踩踏动作 `git checkout`/`git rebase` 全是 **Bash**，不触发它。Bash 有 `bash-guard.sh` 但只做凭据/代码扫描。
2. **分支缝隙**：检查只在 HEAD 已在 `cp-*` 时触发。踩踏起点是 `git checkout cp-*`（把主仓库变工作台），收尾是 `git checkout main`——在 main 分支时根本不触发。

**精确根治点**：拦截"在主仓库执行 `git checkout/switch` 到 cp-*/feature 分支"这个**起点 Bash 动作**。拦住它，主仓库 HEAD 永远进不了 cp-*，后续 rebase/checkout 踩踏链整条断掉。

## 方案

### 组件 1（主防线）：worktree-checkout-guard.sh

- 新建 `packages/engine/hooks/worktree-checkout-guard.sh`，PreToolUse Bash 守卫。
- 注册到 `packages/engine/.claude/settings.json` 现有 Bash matcher（数组追加，与 bash-guard 并列）。
- 逻辑：
  1. 从 PreToolUse payload 读 `tool_input.command`。
  2. 命令不含 `git checkout`/`git switch` → 立即 exit 0（性能：绝大多数 Bash 命令秒过）。
  3. 只处理**分支切换形态**：`git checkout [-b] <branch>`、`git switch [-c] <branch>`。文件/路径 checkout（`git checkout -- <path>`、`git checkout <ref> -- <path>`）和 commit/tag detach 一律放行。解析出的目标分支名若不是 `cp-*`/`feature/*` → exit 0（放行 `git checkout main`/`develop`）。
  4. 判定当前是否主仓库：`git rev-parse --git-dir` 不含 `worktrees` → 主仓库。
  5. 主仓库 + 目标是 cp-*/feature → **exit 2** + stderr 引导："禁止在主仓库 checkout 任务分支，请在 ~/worktrees 独立 worktree 开发（运行 /dev 或 worktree-manage.sh create）"。
  6. 在 worktree 内 → exit 0（放行）。
- 单一职责：只管"主仓库禁 checkout 任务分支"，不碰凭据/代码扫描（那是 bash-guard）。

### 组件 2（契约修正 — 仅 cecelia repo 内部分）

> **跨 repo 边界**：`engine-worktree` SKILL.md 的真实源在 `zenithjoy-skills` repo（user skill，symlink 挂到 ~/.claude/skills），**不在 cecelia**。按 skill 两类分布规则，user skill 改动必须走 skill-creator + zenithjoy-skills 的独立 PR，不能进本 cecelia `[CONFIG]` PR。故 SKILL.md line19 "cd" 文字修正**剥离为 follow-up**（见下方"后续 follow-up"），本 PR 不动它。

- `packages/engine/skills/dev/scripts/worktree-manage.sh`（在 cecelia repo，本 PR 改）：
  - `cmd_init_or_check`：在主仓库成功创建 worktree 后，输出清晰的"✅ worktree 已创建，请 cd <path> 继续"，不再用会被误读为失败的 `exit 1` 自检（区分"刚创建待调用方 cd" vs 真正的"以为在 worktree 但不在"）。脚本是子进程、`cd` 改不了父进程 cwd 这一事实，通过显式输出告知调用方，而非假装已 cd。

### 组件 3：回归测试

- `packages/engine/tests/integration/worktree-checkout-guard.test.sh`，复用 `dev-mode-tool-guard.test.sh` 范式（临时 git repo + helper）。
- Case：
  - A. 主仓库 HEAD 在 main，命令 `git checkout -b cp-xxx` / `git checkout cp-xxx` → exit 2。
  - B. 主仓库，命令 `git checkout main` → exit 0（放行）。
  - C. worktree 内，命令 `git checkout cp-xxx` → exit 0（放行）。
  - D. 命令与 git checkout 无关（如 `ls`）→ exit 0。
- CI `engine-tests-shell`（.github/workflows/ci.yml）glob 自动捕获。

## 版本与注册（[CONFIG] 三要素）

- Engine 版本 19.2.2 → 19.2.3，bump 5 文件：package.json / package-lock.json / VERSION / .hook-core-version / regression-contract.yaml（+ hooks/VERSION、hooks/.hook-core-version 保持同步）。
- feature-registry.yml 新增 `worktree-checkout-guard` 条目 + changelog。
- regression-contract.yaml 新增回归条目（H1-004：主仓库禁 checkout cp-*/feature）。
- PR title 含 `[CONFIG]`。

## TDD 顺序

- commit-1：worktree-checkout-guard.test.sh（Red，hook 尚不存在或为空 → 失败）。
- commit-2：worktree-checkout-guard.sh 实现 + settings.json 注册 + 契约修正 + 版本 bump + registry（Green）。

## 不做（YAGNI）

- git post-checkout hook + `.githooks/` + core.hooksPath 改造：主防线已覆盖 Claude agent 主场景（Cecelia 自动化），手动终端 checkout 是边缘场景，留后续迭代。
- 不改 bash-guard.sh / branch-protect.sh 的现有逻辑（只新增独立 hook，最小爆炸半径）。

## 后续 follow-up（不在本 PR）

- zenithjoy-skills repo：经 skill-creator 修正 `engine-worktree/SKILL.md` line19 关于 init-or-check "会 cd" 的不实表述，与本 PR 改后的 worktree-manage.sh 输出对齐。走 zenithjoy-skills 独立 PR。
