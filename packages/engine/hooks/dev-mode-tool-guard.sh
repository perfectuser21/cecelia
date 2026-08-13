#!/usr/bin/env bash
# ============================================================================
# dev-mode-tool-guard.sh — PreToolUse 拦截器（v23 心跳模型 + Ralph 模式行为强制）
# ============================================================================
# 在 .cecelia/lights/*.live 存在且 mtime 新鲜时（assistant 在 /dev 流程中）禁止：
#   - ScheduleWakeup（让 assistant 主动调度退出 turn）
#   - Bash run_in_background:true（让命令后台跑、turn 立即退出）
#
# 这些工具让 assistant 绕过 stop hook 循环——stop hook exit 2 + decision:block
# 只让"下一轮"自动开始，而 ScheduleWakeup 后没有"下一轮"。
#
# 拦截后 assistant 没有任何工具能主动让 turn 退出 → 唯一让 turn 退出的路径
# = stop hook 自己输出 decision:allow（PR 真完成）。
#
# 信号源 v23 心跳模型：lights/<sid_short>-<branch>.live mtime < TTL（默认 300s）。
# TTL 与 stop-dev.sh 共享 STOP_HOOK_LIGHT_TTL_SEC 环境变量。
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

# receipt lock 属于精确 worktree，不能从共享主仓库读取；lights 仍由主仓库共享。
WORKTREE_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || true)
[[ -z "$WORKTREE_ROOT" ]] && exit 0  # 不在 git → 放行
MAIN_REPO=$(git -C "$CWD" worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2; exit}' || true)
[[ -z "$MAIN_REPO" ]] && MAIN_REPO="$WORKTREE_ROOT"

# 所有可能写仓的工具在动作前共用 Work Router receipt 安全闸。未知 Bash
# 命令按写入处理；只读诊断工具保持可用，便于修复失效凭证。
case "$TOOL_NAME" in
    Read|Grep|Glob|WebFetch|WebSearch|ScheduleWakeup) MUTATION_CAPABLE=false ;;
    *) MUTATION_CAPABLE=true ;;
esac
if [[ "$MUTATION_CAPABLE" == "true" ]]; then
    BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
    LOCK_FILE="$WORKTREE_ROOT/.dev-lock.$BRANCH"
    if [[ ! -f "$LOCK_FILE" ]]; then
        echo '{"decision":"block","reason":"route_violation: live /dev routing receipt lock required"}'
        exit 2
    fi
    routing_receipt_id=$(jq -r '.routing_receipt_id // empty' "$LOCK_FILE" 2>/dev/null || true)
    task_id=$(jq -r '.task_id // empty' "$LOCK_FILE" 2>/dev/null || true)
    run_id=$(jq -r '.run_id // empty' "$LOCK_FILE" 2>/dev/null || true)
    repo=$(jq -r '.repo // empty' "$LOCK_FILE" 2>/dev/null || true)
    lock_branch=$(jq -r '.branch // empty' "$LOCK_FILE" 2>/dev/null || true)
    base_sha=$(jq -r '.base_sha // empty' "$LOCK_FILE" 2>/dev/null || true)
    if [[ -z "$routing_receipt_id" || -z "$task_id" || -z "$run_id" || -z "$repo" \
        || -z "$base_sha" || "$lock_branch" != "$BRANCH" ]]; then
        echo '{"decision":"block","reason":"route_violation: incomplete routing receipt lock"}'
        exit 2
    fi
    if [[ ! "$base_sha" =~ ^[a-f0-9]{40}$ ]] \
        || ! git -C "$WORKTREE_ROOT" cat-file -e "$base_sha^{commit}" 2>/dev/null \
        || ! git -C "$WORKTREE_ROOT" merge-base --is-ancestor "$base_sha" HEAD 2>/dev/null; then
        echo '{"decision":"block","reason":"route_violation: routing baseline is not current lineage"}'
        exit 2
    fi
    validation=$(curl -fsS --max-time 5 -X POST "${BRAIN_URL:-http://localhost:5221}/api/brain/work-routing/validate" \
        -H 'Content-Type: application/json' \
        ${BRAIN_AUTH_TOKEN:+-H "Authorization: Bearer $BRAIN_AUTH_TOKEN"} \
        -d "$(jq -nc --arg routing_receipt_id "$routing_receipt_id" --arg task_id "$task_id" --arg run_id "$run_id" --arg repo "$repo" --arg branch "$BRANCH" --arg base_sha "$base_sha" '{routing_receipt_id:$routing_receipt_id,task_id:$task_id,run_id:$run_id,repo:$repo,branch:$branch,base_sha:$base_sha}')" 2>/dev/null || true)
    if [[ "$(printf '%s' "$validation" | jq -r '.valid // false' 2>/dev/null)" != "true" ]]; then
        echo '{"decision":"block","reason":"route_violation: receipt validation failed"}'
        exit 2
    fi
fi

# 检测 .cecelia/lights/*.live 是否存在且 mtime 新鲜（与 stop-dev.sh 同源）
LIGHTS_DIR="$MAIN_REPO/.cecelia/lights"
[[ ! -d "$LIGHTS_DIR" ]] && exit 0

TTL_SEC="${STOP_HOOK_LIGHT_TTL_SEC:-300}"
NOW=$(date +%s)
DEV_ACTIVE_FOUND=false
for _f in "$LIGHTS_DIR"/*.live; do
    [[ -f "$_f" ]] || continue
    if [[ "$(uname)" == "Darwin" ]]; then
        _mt=$(stat -f %m "$_f" 2>/dev/null || echo 0)
    else
        _mt=$(stat -c %Y "$_f" 2>/dev/null || echo 0)
    fi
    [[ "$_mt" =~ ^[0-9]+$ ]] || _mt=0
    if (( NOW - _mt <= TTL_SEC )); then
        DEV_ACTIVE_FOUND=true
        break
    fi
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
