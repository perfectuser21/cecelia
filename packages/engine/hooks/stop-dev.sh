#!/usr/bin/env bash
# ============================================================================
# stop-dev.sh — 三态单一出口（v20.1.0）
# ============================================================================
# 入口契约：stop.sh 从 stdin JSON 解析 cwd 并 export CLAUDE_HOOK_CWD
# 业务 SSOT：classify_session（在 devloop-check.sh，封装所有判断到 status 字段）
#
# 三态退出码：
#   exit 0  → done（PR 真完成 + cleanup_done）。**全文字面只此一处**。
#   exit 99 → not-applicable（bypass / 主分支 / 无 .dev-mode）。
#             由 stop.sh 路由层识别 99 为"此 hook 不适用，继续 architect/decomp"。
#   exit 2  → blocked（业务未完成 OR 探测异常 fail-closed）。
#
# 设计动机：v20.0.0 把 not-dev|done 共用 exit 0，导致 cwd/git rev-parse 抖动
# 误归 not-dev 时 fail-open 误放行（即"PR1 开就停"故障源）。v20.1.0 拆 not-dev
# → exit 99 + classify_session 把探测异常一律收敛到 blocked → exit 2。
# CI 守护：check-single-exit.sh 校验 stop-dev.sh `exit 0` 字面 = 1。
# ============================================================================

set -euo pipefail

# ---- 加载 devloop-check SSOT（含 classify_session）-----------------------
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cwd="${CLAUDE_HOOK_CWD:-$PWD}"

devloop_lib=""
_wt_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || echo "")
for c in \
    "$_wt_root/packages/engine/lib/devloop-check.sh" \
    "$script_dir/../lib/devloop-check.sh" \
    "$HOME/.claude/lib/devloop-check.sh"; do
    [[ -f "$c" ]] && { devloop_lib="$c"; break; }
done
# shellcheck disable=SC1090
[[ -n "$devloop_lib" ]] && source "$devloop_lib"
command -v jq &>/dev/null || jq() { cat >/dev/null 2>&1; echo '{}'; }

# ---- 单一决策 ------------------------------------------------------------
if ! type classify_session &>/dev/null; then
    result='{"status":"blocked","reason":"classify_session 未加载，fail-closed"}'
else
    result=$(classify_session "$cwd" 2>/dev/null) || true
    [[ -z "$result" ]] && result='{"status":"blocked","reason":"classify_session 无输出，fail-closed"}'
fi

status=$(echo "$result" | jq -r '.status // "blocked"' 2>/dev/null || echo "blocked")

# ---- 三态分发：done=0 / not-dev=99 / 其他=2 ------------------------------
case "$status" in
    done)
        # PR 真完成：清理 .dev-mode + 输出 decision=allow（向后兼容 stop hook 协议）
        _dm=$(echo "$result" | jq -r '.dev_mode // ""' 2>/dev/null || echo "")
        [[ -n "$_dm" && -f "$_dm" ]] && rm -f "$_dm"
        reason=$(echo "$result" | jq -r '.reason // ""' 2>/dev/null || echo "")
        jq -n --arg r "$reason" '{"decision":"allow","reason":$r}'
        exit 0
        ;;
    not-dev)
        # 不适用：reason 走 stderr 诊断提示，stdout 静默
        # exit 99 = custom code，stop.sh 识别为 pass-through，继续走 architect/decomp
        reason=$(echo "$result" | jq -r '.reason // ""' 2>/dev/null || echo "")
        [[ -n "$reason" ]] && echo "[stop-dev] $reason" >&2
        exit 99
        ;;
    *)
        # blocked（含探测异常 fail-closed）：附加 action 提示词
        reason=$(echo "$result" | jq -r '.reason // "未知"' 2>/dev/null || echo "未知")
        action=$(echo "$result" | jq -r '.action // ""' 2>/dev/null || echo "")
        run_id=$(echo "$result" | jq -r '.ci_run_id // ""' 2>/dev/null || echo "")
        [[ -n "$action" ]] && reason="${reason}。下一步：${action}。⚠️ 立即执行，禁止询问用户。"

        jq -n --arg r "$reason" --arg id "$run_id" '{"decision":"block","reason":$r,"ci_run_id":$id}'
        exit 2
        ;;
esac
