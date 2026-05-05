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

    # mtime expire（macOS BSD stat -f / Linux GNU stat -c 兼容）
    file_mtime=$(stat -f %m "$_f" 2>/dev/null || stat -c %Y "$_f" 2>/dev/null || echo "$now_epoch")
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

# Pass 2: cwd 路由选 dev_state
#   cp-* 分支 → 取对应 dev-active（多 worktree 不混）
#   主分支 cwd + 仅 1 个 dev-active → 视为单 session 漂移逃避，仍 block（保留旧防护）
#   主分支 cwd + 多个 dev-active → exit 0 不归本 turn 管（多 session 场景）
current_branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
case "$current_branch" in
    cp-*)
        dev_state="$dev_state_dir/dev-active-${current_branch}.json"
        if [[ ! -f "$dev_state" ]]; then
            exit 0  # 当前 cp-* 分支没活跃 dev-active = 不在 /dev 流程
        fi
        ;;
    *)
        # 主分支 / 非 cp-* / 探测失败：看 .cecelia 里 dev-active 数量
        active_files=( "$dev_state_dir"/dev-active-*.json )
        active_count=0
        for _f in "${active_files[@]}"; do
            [[ -f "$_f" ]] && active_count=$((active_count + 1))
        done
        if [[ "$active_count" -eq 1 ]]; then
            # 单 session 漂主仓库逃避场景 → 仍 block（保留 PR #2503 设计意图）
            for _f in "$dev_state_dir"/dev-active-*.json; do
                [[ -f "$_f" ]] && { dev_state="$_f"; break; }
            done
        else
            # 0 个（无活跃 session）或 多个（多 session 不混）→ exit 0
            exit 0
        fi
        ;;
esac

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
