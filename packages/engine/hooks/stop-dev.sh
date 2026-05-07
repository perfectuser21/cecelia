#!/usr/bin/env bash
# ============================================================================
# stop-dev.sh — Ralph Loop 模式（v21.0.0）
# ============================================================================
# 信号源：项目根 .cecelia/dev-active-<branch>.json（照搬官方 ralph-loop 插件）
# 完成判定：hook 主动验证（PR merged + Learning 文件 + cleanup.sh 真跑）
#
# 三层防御：
#   1. 项目根状态文件（不依赖 cwd）— assistant 漂到主仓库不放行
#   2. 文件生命周期完全在 hook 手里 — assistant 不参与
#   3. 完成判定主动验证 — 不读 .dev-mode 字段（assistant 改不了）
#
# 出口协议（Ralph 风格 decision:block + exit 0）：
#   状态文件不存在 → exit 0（普通对话放行）
#   完成验证 done → rm 状态文件 + exit 0
#   未完成 → decision:block + reason 注入 + exit 0
# ============================================================================

# v18.22.0: BUG-1 / BUG-4 cwd 路由 + mtime expire 段含 OS 兼容性陷阱（stat -f
# vs -c / glob 无匹配 / [[ ]] && stmt 链）容易让 set -e 早退。stop-dev.sh
# 出口协议本就是单一 exit 0，中间命令 fail 应继续走 fallback 路径，不需 set -e。
set -uo pipefail

# ---- 读 hook stdin payload（Stop Hook 协议传 session_id）-----------------
# v22.0.0: session_id 路由（彻底解 multi-session 串线）
# 必须最先读 stdin（只能读一次，否则下游 sub-shell 拿不到）
hook_payload=""
if [[ -t 0 ]]; then
    hook_payload="{}"  # tty 直跑（测试 / 手动），无 stdin payload
else
    hook_payload=$(cat 2>/dev/null || echo "{}")
fi
hook_session_id=$(echo "$hook_payload" | jq -r '.session_id // ""' 2>/dev/null || echo "")

# ---- 逃生通道 ------------------------------------------------------------
[[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]] && exit 0

# ---- 找主仓库根（不依赖 cwd 是否在 worktree）-----------------------------
cwd="${CLAUDE_HOOK_CWD:-$PWD}"
[[ ! -d "$cwd" ]] && exit 0

# git worktree list 第一行是主仓库（无 git 时 git 报错，set -euo pipefail 会让脚本崩；用 || true 兜底）
main_repo=$(git -C "$cwd" worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2; exit}' || true)
[[ -z "$main_repo" ]] && exit 0  # 不在 git → 普通对话

# ---- 找当前活跃的 dev session 状态文件 ------------------------------------
dev_state_dir="$main_repo/.cecelia"
if [[ ! -d "$dev_state_dir" ]]; then
    exit 0  # 没有 .cecelia 目录 = 没有 dev 流程
fi

# v18.22.0: BUG-1 cwd 路由 + BUG-4 mtime expire
#
# 第一遍：清 ghost (session_id=unknown) + mtime expire (> N 分钟)
#   - ghost: 远端 worker sync 没传 session_id 的状态文件
#   - mtime expire: dev-active 长时间没更新（如 P5/P6 fail 永久 stuck）→ 自动 rm
#
# 第二遍：用当前 cwd 解析 worktree branch，**只**取对应 dev-active
#   - cp-* 分支 → 取 dev-active-${branch}.json（不混 multi-worktree 并发）
#   - 主分支/非 cp-* → exit 0 不归本 session 管
#
# 修 BUG-1（PR #2503 名实不符 — 字典序第一 break）+ BUG-4（P5/P6 fail 永久 stuck）

EXPIRE_MINUTES="${STOP_HOOK_EXPIRE_MINUTES:-30}"
now_epoch=$(date +%s)

# Pass 1: ghost rm + mtime expire
for _f in "$dev_state_dir"/dev-active-*.json; do
    [[ -f "$_f" ]] || continue

    sid=$(jq -r '.session_id // ""' "$_f" 2>/dev/null || echo "")
    if [[ "$sid" == "unknown" ]]; then
        wt=$(jq -r '.worktree // ""' "$_f" 2>/dev/null || echo "")
        echo "[stop-dev] ghost rm: $_f (session_id=unknown wt=$wt)" >&2
        rm -f "$_f"
        continue
    fi

    # mtime expire（uname 区分 BSD vs GNU stat — Linux GNU stat -f 是 fs 信息不是 mtime）
    if [[ "$(uname)" == "Darwin" ]]; then
        file_mtime=$(stat -f %m "$_f" 2>/dev/null || echo "$now_epoch")
    else
        file_mtime=$(stat -c %Y "$_f" 2>/dev/null || echo "$now_epoch")
    fi
    # 防 file_mtime 非数字（fallback 失败）
    [[ "$file_mtime" =~ ^[0-9]+$ ]] || file_mtime="$now_epoch"
    age_min=$(( (now_epoch - file_mtime) / 60 ))
    if [[ "$age_min" -gt "$EXPIRE_MINUTES" ]]; then
        echo "[stop-dev] expired rm: $_f (age=${age_min}m > ${EXPIRE_MINUTES}m)" >&2
        # 顺手清 deploy fail counter
        branch_in=$(jq -r '.branch // ""' "$_f" 2>/dev/null || echo "")
        [[ -n "$branch_in" ]] && rm -f "$dev_state_dir/deploy-fail-count-${branch_in}"
        rm -f "$_f"
        continue
    fi
done

# Pass 2: session_id 精确路由（v22.0.0 — 多 session 物理隔离的核心）
#
# 优先级：
#   A. hook_session_id 命中 dev-active.session_id → 该 dev-active 是我的（精确匹配）
#   B. fallback：cwd→branch 路由（兼容旧 dev-active schema，过渡期保留）
#
# 没匹配 → exit 0 不归本 session 管，普通对话 / 不在 /dev 流程
dev_state=""

# A. session_id 精确匹配（首选）— 同时匹配 dev-active.session_id 和
#    .main_session_id 两个字段，前者是 env var（CLAUDE_SESSION_ID，sub-shell
#    可能被 CC framework 覆盖成 tool-call 级 ID），后者是 ps 沿 PPID 找主
#    claude --session-id（=hook stdin payload session_id）。任一字段命中视为归本 session 管。
if [[ -n "$hook_session_id" ]]; then
    for _f in "$dev_state_dir"/dev-active-*.json; do
        [[ -f "$_f" ]] || continue
        sid=$(jq -r '.session_id // ""' "$_f" 2>/dev/null || echo "")
        msid=$(jq -r '.main_session_id // ""' "$_f" 2>/dev/null || echo "")
        if [[ -n "$sid" && "$sid" == "$hook_session_id" ]] || \
           [[ -n "$msid" && "$msid" == "$hook_session_id" ]]; then
            dev_state="$_f"
            break
        fi
    done
fi

# B. fallback: cwd→branch 路由（兼容旧 schema，新创建的 dev-active 应已匹配 A）
if [[ -z "$dev_state" ]]; then
    current_branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    case "$current_branch" in
        cp-*)
            _f="$dev_state_dir/dev-active-${current_branch}.json"
            [[ -f "$_f" ]] && dev_state="$_f"
            ;;
        *)
            # 主分支 cwd：v22.0.0 不再做"单 dev-active 漂移逃避"防护
            # 因为 session_id 路由已能精准识别，主分支放行就是放行
            :  # exit 0（下面统一处理）
            ;;
    esac
fi

# 没找到归属本 session 的 dev-active → 放行（普通对话或别的 session 的 dev）
if [[ -z "$dev_state" ]]; then
    exit 0
fi

# ---- 加载 devloop-check 库（含 verify_dev_complete）-----------------------
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
devloop_lib=""
for c in \
    "$main_repo/packages/engine/lib/devloop-check.sh" \
    "$script_dir/../lib/devloop-check.sh" \
    "$HOME/.claude/lib/devloop-check.sh"; do
    [[ -f "$c" ]] && { devloop_lib="$c"; break; }
done
# shellcheck disable=SC1090
[[ -n "$devloop_lib" ]] && source "$devloop_lib"
command -v jq &>/dev/null || jq() { cat >/dev/null 2>&1; echo '{}'; }

# ---- 解析状态文件 --------------------------------------------------------
branch=$(jq -r '.branch // ""' "$dev_state" 2>/dev/null)
worktree_path=$(jq -r '.worktree // ""' "$dev_state" 2>/dev/null)

if [[ -z "$branch" || -z "$worktree_path" ]]; then
    jq -n '{"decision":"block","reason":"状态文件 .cecelia/dev-active-*.json 损坏，无法解析 branch/worktree。请检查或重启 /dev 流程。⚠️ 立即执行，禁止询问用户。禁止删除 .cecelia/dev-active-*.json。"}'
    exit 0
fi

# ---- hook 主动验证三完成条件 ---------------------------------------------
if ! type verify_dev_complete &>/dev/null; then
    jq -n '{"decision":"block","reason":"verify_dev_complete 未加载（devloop-check.sh），fail-closed。⚠️ 立即执行，禁止询问用户。"}'
    exit 0
fi

# v18.21.0: 默认启用 P5 (deploy workflow) + P6 (health probe)
# escape hatch: 用户外部 export VERIFY_*=0 可禁用（:= 仅在变量未设时赋默认）
result=$(
    : "${VERIFY_DEPLOY_WORKFLOW:=1}"
    : "${VERIFY_HEALTH_PROBE:=1}"
    export VERIFY_DEPLOY_WORKFLOW VERIFY_HEALTH_PROBE
    verify_dev_complete "$branch" "$worktree_path" "$main_repo" 2>/dev/null
) || true
[[ -z "$result" ]] && result='{"status":"blocked","reason":"verify_dev_complete 无输出，fail-closed"}'

status=$(echo "$result" | jq -r '.status // "blocked"' 2>/dev/null || echo "blocked")

# ---- 单一 case + Ralph 风格出口 -----------------------------------------
case "$status" in
    done)
        rm -f "$dev_state"
        dev_mode_file="$worktree_path/.dev-mode.$branch"
        [[ -f "$dev_mode_file" ]] && rm -f "$dev_mode_file"
        # done 路径：reason 走 stderr 诊断，stdout 静默退出（同 Ralph Loop 官方）
        # Claude Code Stop Hook 协议合法 decision 值只有 approve/block — 不输出 decision 字段
        # 直接 exit 0 让 Claude Code 默认放行（turn 真停）
        reason=$(echo "$result" | jq -r '.reason // ""' 2>/dev/null || echo "")
        [[ -n "$reason" ]] && echo "[stop-dev] $reason" >&2
        sid_for_log="${hook_session_id:0:8}"
        log_hook_decision "$sid_for_log" "release" "verify_done" 1 "$branch"
        exit 0
        ;;
    *)
        reason=$(echo "$result" | jq -r '.reason // "未知"' 2>/dev/null || echo "未知")
        action=$(echo "$result" | jq -r '.action // ""' 2>/dev/null || echo "")
        run_id=$(echo "$result" | jq -r '.ci_run_id // ""' 2>/dev/null || echo "")
        full_reason="${reason}"
        [[ -n "$action" ]] && full_reason="${full_reason}。下一步：${action}"
        full_reason="${full_reason}。⚠️ 立即执行，禁止询问用户。禁止删除 .cecelia/dev-active-*.json。"
        jq -n --arg r "$full_reason" --arg id "$run_id" \
            '{"decision":"block","reason":$r,"ci_run_id":$id}'
        sid_for_log="${hook_session_id:0:8}"
        log_hook_decision "$sid_for_log" "block" "verify_pending" 1 "$branch"
        exit 0
        ;;
esac
