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

set -euo pipefail

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

# 找任意 dev-active-*.json（理论上同时只有一个）
# v18.21.0: ghost 过滤 — 远端 sync 来的状态文件不该 block 本机 stop hook
#   判据: session_id="unknown"
#   理由: 本机 worktree-manage.sh 总是写真 session_id（CLAUDE_SESSION_ID 或
#         "headed-PID-branch"），只有远端 worker sync 没传 session_id 才出
#         "unknown"。命中 → 自动 rm + continue
dev_state=""
for _f in "$dev_state_dir"/dev-active-*.json; do
    [[ -f "$_f" ]] || continue

    sid=$(jq -r '.session_id // ""' "$_f" 2>/dev/null || echo "")

    if [[ "$sid" == "unknown" ]]; then
        wt=$(jq -r '.worktree // ""' "$_f" 2>/dev/null || echo "")
        echo "[stop-dev] 自动清理 ghost dev-active (session_id=unknown): $_f (wt=$wt)" >&2
        rm -f "$_f"
        continue
    fi

    dev_state="$_f"
    break
done

if [[ -z "$dev_state" ]]; then
    exit 0  # 没活跃 session = 普通对话
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
        exit 0
        ;;
esac
