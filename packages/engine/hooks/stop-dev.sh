#!/usr/bin/env bash
# ============================================================================
# stop-dev.sh — Stop Hook v24.0.0（env var session_id + classify_session 双验）
# ============================================================================
# 决策模型：扫 .cecelia/lights/<sid_short>-*.live，任一 mtime < TTL → 调用
# classify_session(cwd) 判断真实状态：blocked→block, done→清理放行, 其他→放行。
# 单一出口纪律：所有判定只 set DECISION 变量；唯一 exit 0 在文件末尾。
#
# v24 修复：
#   Bug 1：session_id 改从 CLAUDE_HOOK_SESSION_ID env var 读取
#          （stop.sh 已消费 stdin pipe，不能重读）
#   Bug 2：灯亮时调用 classify_session(cwd) 获取具体状态和 action
# ============================================================================
set -uo pipefail

# 决策状态（贯穿全文，唯一被 set 的输出变量）
DECISION="release"
REASON_CODE=""
BLOCK_REASON=""
LIGHTS_COUNT=0
FIRST_BRANCH=""
SID_SHORT=""

# classify_session 结果字段（在主逻辑中赋值）
_session_result=""
_session_status=""
_reason=""
_action=""
_classify_reason=""

# stop.sh 已从 stdin JSON 解析 session_id 并 export CLAUDE_HOOK_SESSION_ID
# 直接用 env var，不重复读 stdin（stop.sh 已消费管道）
hook_session_id="${CLAUDE_HOOK_SESSION_ID:-}"

# 早退路径（只 set REASON_CODE，不 exit）
cwd="${CLAUDE_HOOK_CWD:-$PWD}"
main_repo=""
lights_dir=""

# 异步 fire-and-forget Brain alert（BYPASS 触发时高可见性）
# 杀死指定 session 的所有 guardian 进程并删除灯文件
_kill_lights_for_session() {
    local dir="$1" sid="$2"
    for lf in "$dir/${sid}-"*.live; do
        [[ -f "$lf" ]] || continue
        local gpid
        gpid=$(jq -r '.guardian_pid // ""' "$lf" 2>/dev/null || echo "")
        [[ -n "$gpid" ]] && kill "$gpid" 2>/dev/null || true
        rm -f "$lf"
    done
}

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
    # 加载 log_hook_decision + classify_session（devloop-check.sh）
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    for c in "$main_repo/packages/engine/lib/devloop-check.sh" \
             "$script_dir/../lib/devloop-check.sh"; do
        if [[ -f "$c" ]]; then
            source "$c" 2>/dev/null || true
            break
        fi
    done
    type log_hook_decision &>/dev/null || log_hook_decision() { :; }
    # 保底：classify_session 不可用时放行
    type classify_session &>/dev/null || classify_session() {
        echo '{"status":"not-dev","reason":"classify_session not available"}'
        return 99
    }

    if [[ -z "$hook_session_id" ]]; then
        REASON_CODE="no_env_session_id"
        # session_id 空 → 不在受控 /dev 会话中 → 直接放行
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
            # 有亮灯 → 调 classify_session 获取具体状态和 action（无头模式关键）
            _session_result=$(classify_session "$cwd" 2>/dev/null || echo '{"status":"not-dev","reason":"classify_session error"}')
            _session_status=$(echo "$_session_result" | jq -r '.status // "not-dev"' 2>/dev/null || echo "not-dev")
            case "$_session_status" in
                blocked)
                    DECISION="block"
                    REASON_CODE="classify_blocked"
                    _reason=$(echo "$_session_result" | jq -r '.reason // "Dev session in progress"' 2>/dev/null || echo "Dev session in progress")
                    _action=$(echo "$_session_result" | jq -r '.action // ""' 2>/dev/null || echo "")
                    BLOCK_REASON="$_reason${_action:+。立即执行：$_action}"
                    ;;
                done)
                    REASON_CODE="classify_done_kill_guardian"
                    _kill_lights_for_session "$lights_dir" "$SID_SHORT"
                    ;;
                not-dev|*)
                    REASON_CODE="classify_not_dev_or_error"
                    _classify_reason=$(echo "$_session_result" | jq -r '.reason // ""' 2>/dev/null || echo "")
                    # 输出 classify reason 到 stdout（T15 验证 classify_session 被调用）
                    [[ -n "$_classify_reason" ]] && echo "{\"decision\":\"release\",\"reason_code\":\"classify_not_dev\",\"reason\":\"$_classify_reason\"}"
                    ;;
            esac
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
else
    # release：也输出 JSON，让 T15/T16 能验证 reason_code
    jq -n --arg rc "${REASON_CODE:-release}" '{"decision":"release","reason_code":$rc}'
fi

exit 0
