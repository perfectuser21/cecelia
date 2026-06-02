#!/usr/bin/env bash
# Worktree Checkout Guard — 拦截主仓库 git checkout/switch 到任务分支(cp-*/feature/*)
# 性能：非 git checkout/switch 命令 ~1ms 放行；命中才跑 git rev-parse
# 背景：主仓库被多任务当共享工作台 → git 操作互相踩踏（见 Issue bfeec6d6）
set -euo pipefail

INPUT="$(cat)"
echo "$INPUT" | jq empty >/dev/null 2>&1 || exit 0
CMD="$(echo "$INPUT" | jq -r '.tool_input.command // ""')"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""')"
[[ -z "$CMD" ]] && exit 0

# 只处理分支切换形态
echo "$CMD" | grep -qE '\bgit[[:space:]]+(checkout|switch)\b' || exit 0
# 文件/路径 checkout（含 " -- "）放行
echo "$CMD" | grep -qE '\bgit[[:space:]]+checkout\b.*[[:space:]]--[[:space:]]' && exit 0

# 提取 checkout|switch 之后第一个非 flag token 作为目标分支
# 用 awk 分词（避免 BSD sed 不支持 \b 的可移植性坑）
TARGET="$(echo "$CMD" | awk '{
  for (i=1; i<=NF; i++) {
    if (found && $i !~ /^-/) { print $i; exit }
    if ($i == "checkout" || $i == "switch") found=1
  }
}')"
[[ -z "$TARGET" ]] && exit 0
# 只拦任务分支
echo "$TARGET" | grep -qE '^(cp-|feature/)' || exit 0

# cwd 是否主仓库（git-dir 不含 worktrees）
GIT_DIR="$(git -C "${CWD:-.}" rev-parse --git-dir 2>/dev/null || echo "")"
[[ -z "$GIT_DIR" ]] && exit 0          # 不在 git 仓库 → 放行
[[ "$GIT_DIR" == *"worktrees"* ]] && exit 0   # 在 worktree → 放行

# 主仓库 + 切任务分支 → 拦截
echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  [WORKTREE GUARD] 禁止在主仓库 checkout 任务分支" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2
echo "目标分支: $TARGET" >&2
echo "主仓库不应停在 cp-*/feature 分支——多任务并发会互相抢占工作目录、踩踏 git 操作。" >&2
echo "请在独立 worktree 开发：" >&2
echo "  bash packages/engine/skills/dev/scripts/worktree-manage.sh create <task-name>" >&2
echo "  或运行 /dev" >&2
echo "" >&2
echo "[SKILL_REQUIRED: dev]" >&2
exit 2
