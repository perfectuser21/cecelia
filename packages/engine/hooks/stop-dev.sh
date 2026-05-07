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

if [[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]]; then
    REASON_CODE="bypass"
elif [[ ! -d "$cwd" ]]; then
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
