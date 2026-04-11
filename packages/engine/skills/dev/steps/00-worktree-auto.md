---
id: dev-step-00-worktree-auto
version: 3.0.0
updated: 2026-04-02
changelog:
  - 3.0.0: 精简 — 保留核心 worktree 创建逻辑
---

# Step 0: Worktree 强制创建

> /dev 启动后第一件事：确保在独立 worktree 中工作。

---

## 1. 检测是否已在 worktree 中

```bash
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
if [[ "$GIT_DIR" == *"worktrees"* ]]; then
    echo "✅ 已在 worktree 中"
    
    # .dev-lock 完整性检查（context 恢复场景）
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
    DEV_MODE_FILE="$PROJECT_ROOT/.dev-mode.${CURRENT_BRANCH}"
    DEV_LOCK_FILE="$PROJECT_ROOT/.dev-lock.${CURRENT_BRANCH}"
    
    # 计算 tty（避免在 heredoc 内调用 tty 命令导致"not a tty\nnone"双行问题）
    _LOCK_TTY=$(tty 2>/dev/null) || _LOCK_TTY="none"
    if [[ -f "$DEV_MODE_FILE" && ! -f "$DEV_LOCK_FILE" ]]; then
        _branch_from_mode=$(grep "^branch:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2- | xargs 2>/dev/null || echo "$CURRENT_BRANCH")
        cat > "$DEV_LOCK_FILE" <<LOCKEOF
dev
branch: ${_branch_from_mode:-$CURRENT_BRANCH}
session_id: headed-$(date +%s)-$$-${_branch_from_mode:-$CURRENT_BRANCH}
tty: ${_LOCK_TTY}
created: $(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)
LOCKEOF
        echo "✅ .dev-lock 已重建（含 session 字段）"
    elif [[ ! -f "$DEV_LOCK_FILE" ]]; then
        cat > "$DEV_LOCK_FILE" <<LOCKEOF
dev
branch: ${CURRENT_BRANCH}
session_id: headed-$(date +%s)-$$-${CURRENT_BRANCH}
tty: ${_LOCK_TTY}
created: $(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)
LOCKEOF
        echo "✅ .dev-lock 已创建"
    fi
    # 跳过创建，继续 Step 1
    exit 0
fi

echo "📍 当前在主仓库，需要创建 worktree"
```

---

## 2. 创建 worktree

```bash
# 找 worktree-manage.sh
_WMANAGE=""
for _dir in ~/.claude-account1/skills/dev/scripts ~/.claude/skills/dev/scripts; do
    [[ -f "$_dir/worktree-manage.sh" ]] && { _WMANAGE="$_dir/worktree-manage.sh"; break; }
done
[[ -z "$_WMANAGE" ]] && { echo "❌ 找不到 worktree-manage.sh"; exit 1; }

WORKTREE_PATH=$(bash "$_WMANAGE" create "$TASK_NAME" 2>/dev/null | tail -1)
cd "$WORKTREE_PATH" || exit 1
echo "✅ Worktree: $(pwd), 分支: $(git rev-parse --abbrev-ref HEAD)"
```

---

## 3. 自检

```bash
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$GIT_DIR" != *"worktrees"* ]] && echo "❌ 未在 worktree 中" && exit 1
[[ ! "$CURRENT_BRANCH" =~ ^(cp-|feature/) ]] && echo "❌ 分支名不符合 cp-* 格式" && exit 1
echo "✅ Step 0 自检通过"
```

继续 → Step 1 (Spec)
