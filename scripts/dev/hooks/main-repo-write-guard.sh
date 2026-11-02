#!/usr/bin/env bash
# main-repo-write-guard.sh — PreToolUse hook（backstop）
# 拦主仓工作树内的写操作：Write/Edit 全拦；Bash 只拦 git commit / git add。
# 只读操作、worktree 内任意操作 一律放行。
#
# 主仓判定：git rev-parse --git-dir == git rev-parse --git-common-dir。
# 在 linked worktree 里两者不同（--git-dir 指向 .git/worktrees/<name>，
# --git-common-dir 指向共享的 .git）；在主仓里两者相同。
#
# 入口契约：stdin JSON 传 tool_name / tool_input / cwd（测试用 HOOK_INPUT env
# var 覆盖 stdin，因为 vitest 子进程管道 stdin 不可靠——与仓库其它 hook 测试同套路）。
# 退出码：0 = 放行；2 = block（stdout 输出 decision:block JSON）。
set -uo pipefail

INPUT="${HOOK_INPUT:-$(cat 2>/dev/null || echo '{}')}"

_field() {
    local key="$1"
    echo "$INPUT" | jq -r --arg k "$key" '.[$k] // empty' 2>/dev/null
}

TOOL_NAME="$(_field tool_name)"
CWD="$(_field cwd)"
[[ -z "$CWD" ]] && CWD="$PWD"
[[ ! -d "$CWD" ]] && exit 0

GD="$(git -C "$CWD" rev-parse --git-dir 2>/dev/null)" || exit 0
CMN="$(git -C "$CWD" rev-parse --git-common-dir 2>/dev/null)" || exit 0
[[ "$GD" != "$CMN" ]] && exit 0   # 在 worktree 里 → 放行

IS_WRITE=0
case "$TOOL_NAME" in
    Write|Edit)
        IS_WRITE=1
        ;;
    Bash)
        CMD="$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
        if echo "$CMD" | grep -qE '\bgit[[:space:]]+(commit|add)\b'; then
            IS_WRITE=1
        fi
        ;;
esac

[[ "$IS_WRITE" != "1" ]] && exit 0

cat <<'EOF'
{
  "decision": "block",
  "reason": "🚫 你在主仓工作树，禁止直接改动。跑 /dev 或 cd 进你的 session worktree（worktrees/<project>/session-<sid>）。"
}
EOF
exit 2
