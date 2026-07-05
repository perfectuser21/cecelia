# Spec：session 隔离根治（launcher 自动 worktree + hook 硬拦主仓写）

> Brain task: `c4a35241-75bd-4170-ac91-a4ee683dd81b`（P1）。主理人 2026-07-05 拍板"两者都要"。设计已批准，跳过 brainstorming 多轮提问，直接进 writing-plans。
> 来源：`docs/current/session-isolation-design.md`（设计原文）+ `sprints/07051815-session-isolation/prep-prd.md`（PrepPRD），两份内容整合于此，作为唯一实现依据。

## 问题（实测，2026-07-05 上午 9:58→13:xx 打架数小时）

- 多个交互 session 的 cwd 全部落在 `/Users/administrator/perfect21/cecelia`（主仓工作树），且主仓停在某个 `cp-*` 任务分支上（本该停 main）。
- 多 session 共用同一工作树 / 同一分支 / 同一 `.dev-lock` → 互相覆盖文件、踩 git 状态、抢 docker/DB。
- `claude-launch.sh` 现在只保证 `--session-id` + export 给子进程，完全不管把 session 送进独立工作目录。
- 现有 hook 都不管这件事：`dev-mode-tool-guard.sh` 只拦 /dev 流程里的 ScheduleWakeup/后台 Bash；`branch-protect.sh` 是 git pre-commit 拦直推 main；`worktree-checkout-guard.sh` 只拦主仓里 `git checkout cp-*/feature/*`。**没有一个强制 session 进 worktree。**
- 核心误解点：new branch 只隔离代码历史，不隔离工作目录。

## 决策：两者都要

1. **launcher 自动 per-session worktree**（主力隔离）—— 交互模式下把 session 自动送进独立工作目录。
2. **PreToolUse hook 硬拦主仓工作树的写操作**（backstop）—— 防止手动 cd 回主仓后误改。
3. **主仓工作树一次性复位到 main**（清场）。

## A. `scripts/claude-launch.sh` 改造

### 触发条件（自动建/复用 worktree）
交互模式（非 `-p`/`--print`）**且** cwd == 主仓工作树根（`git rev-parse --show-toplevel` 且该 toplevel 的 `git-dir` 不含 `/worktrees/` 路径段，即真主仓而非某个 worktree）时触发。

### 跳过条件（不自动建 worktree，原样走现有逻辑）
- headless：参数含 `-p` 或 `--print`。
- `CECELIA_NO_AUTO_WORKTREE=1`（逃生阀，纯只读/调试场景）。
- cwd 已经在某个 worktree 里（不是主仓根）——尊重现状，直接照旧执行。
- `--dry-run`：只输出最终命令行，不真建 worktree（契约已有，保持不变；新增：dry-run 输出里如果落在"会触发自动 worktree"的场景，需要在输出里体现出 worktree 建立步骤，方便契约测试断言）。

### worktree 路径与命名
- 根目录：`<主仓的父目录>/worktrees/cecelia/session-<sid_short>`（`sid_short` = `CLAUDE_SESSION_ID` 前 8 位，与现有 `worktrees/cecelia/<name>` 布局一致，见本次任务自己所在的 `worktrees/cecelia/session-isolation`）。
- 分支名：`session-<sid_short>`。
- base：`origin/main`（先 `git fetch origin main` 保证新鲜，不是当前 cp-* 分支）。

### 幂等复用
- worktree 路径已存在（mosh 重连/同 session-id 重启）→ 直接 cd 进去，不重建、不重新 `git worktree add`。
- 用 `git worktree list --porcelain` 或直接 `[[ -d "$path" ]] && git -C "$MAIN_REPO" worktree list | grep -q "$path"` 判断是否已注册为合法 worktree（避免残留空目录导致的 `git worktree add` 报错）。

### 执行流程
1. 计算 worktree 路径。
2. 若不存在 → `git fetch origin main --quiet`（失败不致命，退化用本地 origin/main）→ `git worktree add <path> -b session-<sid_short> origin/main`。
3. `cd <path>`。
4. 照常执行原有逻辑（账号切换、`exec claude --session-id ...`）。

### 清理（sprawl 防止）
- launcher 用 `trap ... EXIT` 在 claude 进程退出后检查：若该 session worktree `git status --porcelain` 为空、且无 stash（`git stash list`）、且本地分支未有 unpushed commits（`git log origin/session-<sid>..HEAD` 为空或分支未推送但也无 commit）→ `git worktree remove <path>` + 删本地分支。
- 有任何"脏"（未提交改动/stash/未推送 commit）→ 保留，不清理。
- 注：`exec claude` 会替换当前进程，trap 在 shell 层面不会在 `exec` 之后触发——因此清理逻辑必须挂在 **claude 进程本身退出后** 才能跑到，若 launcher 用 `exec` 整个进程被替换将无法执行退出清理。实现时改为：不对最终的 `exec claude` 使用 `exec`（普通前台执行 `"${FINAL_CMD[@]}"` 然后 `wait`），退出后跑清理，再用该 exit code `exit`。这是本次对现有 `exec` 语义的唯一必要改动；其余分支（headless/已在 worktree/dry-run）保持 `exec` 不变以维持现有行为契约。

### 不变的部分
- `--session-id` + export 逻辑不变。
- 账号切换（`CLAUDE_CONFIG_DIR`）逻辑不变。
- `CLAUDE_CODE_EXECPATH` 优先寻找真 claude binary 的逻辑不变。
- headless（`-p`）路径完全不受影响，继续沿用原 `exec`。

## B. 新 PreToolUse hook：`packages/engine/hooks/main-repo-write-guard.sh`

### 注册
在 `~/.claude/settings.json` 的 `PreToolUse` 里新增一条，matcher 覆盖 `Write|Edit|Bash`（与现有 `branch-protect.sh`/`bash-guard.sh` 同级追加，不替换）。

### 逻辑
输入：Claude Code 通过 stdin JSON 传 `tool_name` / `tool_input` / `cwd`。复用 `dev-mode-tool-guard.sh` 的极简 JSON 提取范式（无 jq 依赖也可、但仓库里 `worktree-checkout-guard.sh` 已经在用 `jq`，本仓库环境有 jq，可直接用 `jq -r`）。

1. 解析 `cwd`。若解析不出或不是 git 仓库 → `exit 0`（放行）。
2. 判断 cwd 是否为**主仓工作树根**：`git -C "$CWD" rev-parse --show-toplevel` 得到 toplevel，再判断该 toplevel 对应的 `git rev-parse --git-common-dir` 是否等于 `git rev-parse --git-dir`（相等 = 主仓；worktree 里两者不同，`--git-dir` 会指向 `.git/worktrees/<name>`）。这个判断法比"路径含 worktrees 字符串"更可靠，因为主仓路径本身可能包含关键字，且不依赖固定路径命名。
3. 若不是主仓工作树根 → `exit 0`（worktree 内任意操作放行）。
4. 是主仓工作树根，判断工具是否为"写类"：
   - `tool_name == "Write"` 或 `"Edit"` → 一律算写类。
   - `tool_name == "Bash"` → 取 `tool_input.command`，用正则匹配是否含 `git commit` / `git add` / 明显的文件写重定向（`>` / `>>`，排除 `2>&1` 这种误判——可以先只覆盖 `git commit`/`git add` 两个命令关键字，写重定向误判率高、且 branch-protect.sh/bash-guard.sh 已经覆盖了直推 main 等更精确的场景，本 hook 只做"档 Edit/Write + git add/commit"这个新增缺口，避免过度设计）。
5. 只读操作（Read/Grep/`git status`/`git log`/`curl` 等）→ 全部放行，不进入判断（第 4 步只在"写类工具"里挑，非写类工具本来就不会命中 matcher 或直接判断为放行）。
6. 命中"主仓 + 写类" → 输出 block JSON：
   ```json
   {
     "decision": "block",
     "reason": "🚫 你在主仓工作树（cwd=主仓根），禁止直接改动。跑 /dev 或 cd 进你的 session worktree（worktrees/cecelia/session-<sid>）。"
   }
   ```
   `exit 2`。
7. 否则 `exit 0`。

### 边界（明确排除，避免范围蔓延）
- 不拦截主仓的 `git checkout main`（复位操作需要能跑）——`git checkout`/`git switch` 已有 `worktree-checkout-guard.sh` 专门处理任务分支场景，本 hook 不重复管 checkout。
- 不拦截只读命令。
- 不处理 headless（Brain/harness 派的任务走 `cecelia-run.sh` 自己的 worktree，cwd 本来就不会等于主仓根，天然不命中）。

## C. 主仓复位

- 一次性：把 `/Users/administrator/perfect21/cecelia` 从当前 `cp-*` 分支 `git checkout main`。
- 现有 untracked 历史文件（`.brain-result.json`/`.cecelia/`/`docs/architecture/` 等）不属于本次任务范围，复位时只处理 `docker-compose.yml` 等已在 main 上有对应版本的**已跟踪文件**改动（可直接 checkout 丢弃或按需保留，视复位时 `git status` 实际情况判断，不预设）；untracked 文件不动。
- 复位后主仓应保持在 main，不再停留在任务分支。

## 验收标准（DoD 用）

- [ ] `claude-launch.sh --dry-run`：模拟"cwd=主仓根 + 交互模式"场景，输出含 worktree 建立步骤（如 `git worktree add`字样或等价的可断言标记）。
- [ ] `claude-launch.sh --dry-run`：headless（`-p ...`）场景，输出不含 worktree 建立步骤。
- [ ] `claude-launch.sh --dry-run`：cwd 已在某 worktree 内场景，输出不含 worktree 建立步骤。
- [ ] `claude-launch.sh --dry-run`：`CECELIA_NO_AUTO_WORKTREE=1` 场景，输出不含 worktree 建立步骤。
- [ ] hook 单测（`main-repo-write-guard.sh`）：主仓 cwd + `Edit`/`Write` → block；主仓 cwd + Bash `git commit`/`git add` → block；主仓 cwd + 只读（Read/`git status`）→ 放行；worktree cwd + 任意工具 → 放行。
- [ ] 主仓工作树已复位到 `main`（`git branch --show-current` == `main`）。
- [ ] CI 全绿。

## 风险与灰度

- 动 `claude-launch.sh` = 动所有交互启动路径。缓解：①保留 `--dry-run` 契约测试覆盖新增分支；②`CECELIA_NO_AUTO_WORKTREE=1` 作为逃生阀；③不改动 headless 路径的既有行为。
- 不破坏 `cecelia-run.sh`（harness/Brain 专用 worktree 逻辑）——本次改动只触碰交互路径的判断分支，headless 分支代码不动。
- hook 新增匹配需窄范围（只加 `git commit`/`git add` 两个关键字），避免和 `branch-protect.sh`/`bash-guard.sh` 已覆盖场景重复判断导致误报。

## 不做的事（明确排除，防范围蔓延）

- 不改造 `cecelia-run.sh` 的 headless worktree 逻辑。
- 不处理"主仓遗留的 untracked 历史文件"清理（`.brain-result.json`/`.cecelia/`/`docs/architecture/` 等），那是独立的仓库卫生任务，不在本次 P1 根治范围。
- 不新增第二套 worktree reaper——复用现有 reaper（如已存在），本次只加"launcher 退出时的即时清理"这一层。
