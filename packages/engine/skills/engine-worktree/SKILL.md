---
name: engine-worktree
version: 15.0.0
updated: 2026-04-19
description: Cecelia Engine /dev 接力链第 1 棒。强制工作在独立 git worktree 的 cp-* 分支（Engine 刻意自造，不使用 Superpowers using-git-worktrees）。
trigger: /dev SKILL.md 的 TERMINAL IMPERATIVE 点火，或 autonomous 模式 Brain 派任务
---

# Engine Worktree — /dev 接力链 Step 1/4

> **CRITICAL LANGUAGE RULE**: 所有输出必须使用简体中文。

**职责单一**：确保主 agent 工作在独立 git worktree 的 `cp-*` 分支。已在 worktree → 仅补齐 .dev-lock；在主仓库 → 创建 worktree 并切入。

## 为什么 Engine 自造而不用 Superpowers using-git-worktrees

Superpowers 的 `using-git-worktrees` skill 是给人用的（会问"要不要新开 worktree"）。Engine 是 autonomous 模式，必须无条件创 worktree + 强制分支名 `cp-*`，决策点全部固化在 `worktree-manage.sh` 里，没有交互。

## 1. 检测是否已在 worktree

```bash
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
if [[ "$GIT_DIR" == *"worktrees"* ]]; then
    echo "✅ 已在 worktree 中"

    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
    DEV_MODE_FILE="$PROJECT_ROOT/.dev-mode.${CURRENT_BRANCH}"
    DEV_LOCK_FILE="$PROJECT_ROOT/.dev-lock.${CURRENT_BRANCH}"

    if [[ -f "$DEV_MODE_FILE" && ! -f "$DEV_LOCK_FILE" ]]; then
        cat > "$DEV_LOCK_FILE" <<LOCKEOF
dev
branch: ${CURRENT_BRANCH}
session_id: headed-$(date +%s)-$$-${CURRENT_BRANCH}
owner_session: ${CLAUDE_SESSION_ID:-unknown}
tty: $(tty 2>/dev/null || echo "none")
created: $(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)
LOCKEOF
        echo "✅ .dev-lock 已重建（含 session info）"
    elif [[ ! -f "$DEV_LOCK_FILE" ]]; then
        cat > "$DEV_LOCK_FILE" <<LOCKEOF
dev
branch: ${CURRENT_BRANCH}
session_id: headed-$(date +%s)-$$-${CURRENT_BRANCH}
owner_session: ${CLAUDE_SESSION_ID:-unknown}
tty: $(tty 2>/dev/null || echo "none")
created: $(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)
LOCKEOF
        echo "✅ .dev-lock 已创建"
    fi
else
    echo "📍 当前在主仓库，需要创建 worktree"
fi
```

## 2. 创建 worktree（主仓库分支）

```bash
if [[ "$GIT_DIR" != *"worktrees"* ]]; then
    _WMANAGE=""
    for _dir in ~/.claude-account1/skills/dev/scripts ~/.claude/skills/dev/scripts; do
        [[ -f "$_dir/worktree-manage.sh" ]] && { _WMANAGE="$_dir/worktree-manage.sh"; break; }
    done
    [[ -z "$_WMANAGE" ]] && { echo "❌ 找不到 worktree-manage.sh"; exit 1; }

    WORKTREE_PATH=$(bash "$_WMANAGE" create "$TASK_NAME" 2>/dev/null | tail -1)
    cd "$WORKTREE_PATH" || exit 1
    echo "✅ Worktree: $(pwd), 分支: $(git rev-parse --abbrev-ref HEAD)"
fi
```

## 3. 自检（强制分支名 cp-* 或 feature/*）

```bash
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$GIT_DIR" != *"worktrees"* ]] && echo "❌ 未在 worktree 中" && exit 1
[[ ! "$CURRENT_BRANCH" =~ ^(cp-|feature/) ]] && echo "❌ 分支名不符合 cp-* 格式" && exit 1
echo "✅ engine-worktree 自检通过"
```

## 完成标志

- `$GIT_DIR` 含 `worktrees`
- 分支名 `cp-*` 或 `feature/*`
- `.dev-lock.<branch>` 存在且含 `owner_session`

---

## TERMINAL IMPERATIVE

engine-worktree 完成。**你的下一个 tool call 必须是**：

```
Skill({"skill":"engine-enrich"})
```

不要 `Read`。不要 `Bash`。不要 `Grep`。不要 inline 执行 PRD 丰满逻辑。

这不是文档引用，这是你下一步的 tool call 指令。engine-enrich 会接力处理 PRD enrich 阶段。
