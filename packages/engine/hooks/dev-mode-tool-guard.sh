#!/usr/bin/env bash
# ============================================================================
# dev-mode-tool-guard.sh — PreToolUse 拦截器（Ralph 模式行为强制）
# ============================================================================
# 在 .cecelia/dev-active-*.json 存在时（assistant 在 /dev 流程中）禁止以下工具：
#   - ScheduleWakeup（让 assistant 主动调度退出 turn）
#   - Bash run_in_background:true（让命令后台跑、turn 立即退出）
#
# 这些工具让 assistant 绕过 stop hook 循环——stop hook exit 2 + decision:block
# 只让"下一轮"自动开始，而 ScheduleWakeup 后没有"下一轮"。
#
# 拦截后 assistant 没有任何工具能主动让 turn 退出 → 唯一让 turn 退出的路径
# = stop hook 自己输出 decision:allow（PR 真完成）。
#
# 入口契约：Claude Code 通过 stdin JSON 传 tool_name / tool_input / cwd / session_id。
# 退出码：exit 0 = 放行；exit 2 = block（stdout decision:block JSON 回填给 assistant）
# ============================================================================

set -uo pipefail

HOOK_INPUT=$(cat 2>/dev/null || echo '{}')

# 极简 JSON 提取（不依赖 jq）
parse_string_field() {
    local key="$1"
    echo "$HOOK_INPUT" | grep -oE "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | sed -E "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/" | head -1
}

TOOL_NAME=$(parse_string_field tool_name)
CWD=$(parse_string_field cwd)
[[ -z "$CWD" ]] && CWD="$PWD"
[[ ! -d "$CWD" ]] && exit 0

# 找主仓库根（cwd 可能在 worktree，git worktree list 第一行是主仓库）
MAIN_REPO=$(git -C "$CWD" worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2; exit}' || true)
[[ -z "$MAIN_REPO" ]] && exit 0  # 不在 git → 放行

# 检测 .cecelia/dev-active-* 是否存在
DEV_ACTIVE_DIR="$MAIN_REPO/.cecelia"
[[ ! -d "$DEV_ACTIVE_DIR" ]] && exit 0

DEV_ACTIVE_FOUND=false
for _f in "$DEV_ACTIVE_DIR"/dev-active-*.json; do
    [[ -f "$_f" ]] && { DEV_ACTIVE_FOUND=true; break; }
done

[[ "$DEV_ACTIVE_FOUND" != "true" ]] && exit 0  # 不在 dev 流程 → 放行

# === 在 dev 流程中 ===

# 拦截 ScheduleWakeup
if [[ "$TOOL_NAME" == "ScheduleWakeup" ]]; then
    cat <<'EOF'
{
  "decision": "block",
  "reason": "🚫 在 /dev 流程中禁止 ScheduleWakeup。让 assistant 主动退出 turn 会让 stop hook 循环形同虚设——stop hook 即使 decision:block 也只让'下一轮'继续，但 ScheduleWakeup 后没有'下一轮'。等 CI 必须用 foreground until 阻塞模式：until [[ $(gh pr checks <PR> | grep -cE 'pending|in_progress|queued') == 0 ]]; do sleep 60; done。或直接 gh pr checks <PR> --watch（同步阻塞）。⚠️ 立即改为 foreground，禁止询问用户。"
}
EOF
    exit 2
fi

# 拦截 Bash run_in_background:true
if [[ "$TOOL_NAME" == "Bash" ]]; then
    RIB=$(echo "$HOOK_INPUT" | grep -oE '"run_in_background"[[:space:]]*:[[:space:]]*(true|false)' | grep -oE '(true|false)' | head -1)
    if [[ "$RIB" == "true" ]]; then
        cat <<'EOF'
{
  "decision": "block",
  "reason": "🚫 在 /dev 流程中禁止 Bash run_in_background:true。后台跑命令会让 turn 立即退出，stop hook 循环形同虚设。改用前台 foreground 阻塞模式。如果是长跑命令（等 CI 等），用 until 模式或 gh pr checks --watch（同步阻塞）。⚠️ 立即改为 foreground，禁止询问用户。"
}
EOF
        exit 2
    fi
fi

exit 0
