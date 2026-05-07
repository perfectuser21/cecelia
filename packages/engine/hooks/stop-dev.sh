#!/usr/bin/env bash
# ============================================================================
# stop-dev.sh — Stop Hook v23.1.0（心跳模型 + 单一出口）
# ============================================================================
# 决策模型：扫 .cecelia/lights/<sid_short>-*.live，任一 mtime < TTL → block。
# 单一出口纪律：所有判定只 set DECISION 变量；唯一 exit 0 在文件末尾。
#
# 这是 v22 历史教训的纠正：v22 209 行 + 8 个分散 exit，加日志/清理/观测要追
# 8 条路径。v23.1 集中到 1 处出口，可观测性 + 可维护性 + 单一出口纪律全到位。
# ============================================================================
set -uo pipefail

# 决策状态（贯穿全文，唯一被 set 的输出变量）
DECISION="release"
REASON_CODE=""
BLOCK_REASON=""
LIGHTS_COUNT=0
FIRST_BRANCH=""
SID_SHORT=""

# Hook stdin（读 session_id）
hook_payload=""
if [[ ! -p /dev/stdin ]]; then
    hook_payload="{}"
else
    hook_payload=$(cat 2>/dev/null || echo "{}")
fi
hook_session_id=$(echo "$hook_payload" | jq -r '.session_id // ""' 2>/dev/null || echo "")

# 早退路径（只 set REASON_CODE，不 exit）
cwd="${CLAUDE_HOOK_CWD:-$PWD}"
main_repo=""
lights_dir=""

# 异步 fire-and-forget Brain alert（BYPASS 触发时高可见性）
fire_bypass_alert() {
    local marker_state="${1:-unknown}"
    local payload
    payload=$(printf '{"title":"[ALERT] STOP HOOK BYPASS fired","priority":"P0","task_type":"alert","description":"hostname=%s ppid=%s marker_state=%s ts=%s","trigger_source":"hook","location":"us","domain":"agent_ops"}' \
        "$(hostname -s 2>/dev/null || echo unknown)" \
        "$PPID" \
        "$marker_state" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
    (curl -s --max-time 2 -X POST "http://localhost:5221/api/brain/tasks" \
        -H "Content-Type: application/json" \
        -d "$payload" </dev/null >/dev/null 2>&1 &)
}

# === BYPASS 双因子 (v23.2)：env + marker（mtime < 30 分钟）===
# AI 改 ~/.zshrc 设 env 不够，必须同时有 .cecelia/.bypass-active 文件
if [[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]]; then
    # 不论结果如何先 alert（高可见性）
    cwd_for_marker="$cwd"
    [[ ! -d "$cwd_for_marker" ]] && cwd_for_marker="$PWD"
    main_for_marker=$(git -C "$cwd_for_marker" worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2; exit}' || true)
    [[ -z "$main_for_marker" ]] && main_for_marker="$cwd_for_marker"

    bypass_marker="$main_for_marker/.cecelia/.bypass-active"
    bypass_state="missing"

    if [[ -f "$bypass_marker" ]]; then
        if [[ "$(uname)" == "Darwin" ]]; then
            marker_mtime=$(stat -f %m "$bypass_marker" 2>/dev/null || echo 0)
        else
            marker_mtime=$(stat -c %Y "$bypass_marker" 2>/dev/null || echo 0)
        fi
        [[ "$marker_mtime" =~ ^[0-9]+$ ]] || marker_mtime=0
        marker_age=$(( $(date +%s) - marker_mtime ))
        BYPASS_MARKER_TTL_SEC="${BYPASS_MARKER_TTL_SEC:-1800}"
        if (( marker_age <= BYPASS_MARKER_TTL_SEC )); then
            bypass_state="valid"
        else
            bypass_state="stale"
        fi
    fi

    fire_bypass_alert "$bypass_state"

    if [[ "$bypass_state" == "valid" ]]; then
        REASON_CODE="bypass"
    fi
    # else: 双因子不满足，falls through 到正常决策流（fail-safe）
fi

if [[ -z "$REASON_CODE" ]]; then
    if [[ ! -d "$cwd" ]]; then
        REASON_CODE="cwd_missing"
    else
        main_repo=$(git -C "$cwd" worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2; exit}' || true)
        if [[ -z "$main_repo" ]]; then
            REASON_CODE="not_in_git"
        else
            lights_dir="$main_repo/.cecelia/lights"
            if [[ ! -d "$lights_dir" ]]; then
                REASON_CODE="no_lights_dir"
            fi
        fi
    fi
fi

# 决策核心（仅当尚未早退）
if [[ -z "$REASON_CODE" ]]; then
    # 加载 log_hook_decision（PR-1 落点：devloop-check.sh）
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    for c in "$main_repo/packages/engine/lib/devloop-check.sh" \
             "$script_dir/../lib/devloop-check.sh"; do
        if [[ -f "$c" ]]; then
            source "$c" 2>/dev/null || true
            break
        fi
    done
    type log_hook_decision &>/dev/null || log_hook_decision() { :; }

    if [[ -z "$hook_session_id" ]]; then
        if [[ ! -p /dev/stdin ]]; then
            REASON_CODE="tty_no_session_id"
        else
            DECISION="block"
            REASON_CODE="no_session_id_pipe"
            BLOCK_REASON="Stop hook 收到空 session_id（系统异常），保守 block。"
        fi
    else
        SID_SHORT="${hook_session_id:0:8}"
        TTL_SEC="${STOP_HOOK_LIGHT_TTL_SEC:-300}"
        now=$(date +%s)

        for light in "$lights_dir/${SID_SHORT}-"*.live; do
            if [[ ! -f "$light" ]]; then
                continue
            fi
            if [[ "$(uname)" == "Darwin" ]]; then
                light_mtime=$(stat -f %m "$light" 2>/dev/null || echo 0)
            else
                light_mtime=$(stat -c %Y "$light" 2>/dev/null || echo 0)
            fi
            if [[ ! "$light_mtime" =~ ^[0-9]+$ ]]; then
                light_mtime=0
            fi
            age=$(( now - light_mtime ))
            if (( age <= TTL_SEC )); then
                LIGHTS_COUNT=$((LIGHTS_COUNT + 1))
                if [[ -z "$FIRST_BRANCH" ]]; then
                    FIRST_BRANCH=$(jq -r '.branch // ""' "$light" 2>/dev/null || echo "")
                fi
            fi
        done

        if (( LIGHTS_COUNT > 0 )); then
            DECISION="block"
            REASON_CODE="lights_alive"
            BLOCK_REASON="还有 ${LIGHTS_COUNT} 条 /dev 在跑（含 ${FIRST_BRANCH}）。立即继续，禁止询问用户。禁止删除 .cecelia/lights/。"
        else
            REASON_CODE="all_dark"
        fi
    fi
fi

# 唯一出口
type log_hook_decision &>/dev/null && \
    log_hook_decision "$SID_SHORT" "$DECISION" "$REASON_CODE" "$LIGHTS_COUNT" "$FIRST_BRANCH"

if [[ "$DECISION" == "block" ]]; then
    jq -n --arg r "$BLOCK_REASON" '{"decision":"block","reason":$r}'
fi

exit 0
