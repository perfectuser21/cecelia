#!/usr/bin/env bash
# ============================================================================
# stop-dev.sh — 单一 exit 0 出口（v20.0.0）
# ============================================================================
# 入口契约：stop.sh 从 stdin JSON 解析 cwd 并 export CLAUDE_HOOK_CWD
# 业务 SSOT：classify_session（在 devloop-check.sh，封装所有判断到 status 字段）
# 单一出口：全文唯一 1 个 exit 0 在末尾 case，永不在中途散点放行。
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

# ---- 单一 case + 单一 exit 0 ---------------------------------------------
case "$status" in
    not-dev|done)
        # done 路径：清理 .dev-mode + 输出 decision=allow（向后兼容 stop hook 协议）
        # not-dev 路径：reason 走 stderr（保留老 stop-dev v19 的诊断提示），stdout 静默
        if [[ "$status" == "done" ]]; then
            _dm=$(echo "$result" | jq -r '.dev_mode // ""' 2>/dev/null || echo "")
            [[ -n "$_dm" && -f "$_dm" ]] && rm -f "$_dm"
            reason=$(echo "$result" | jq -r '.reason // ""' 2>/dev/null || echo "")
            jq -n --arg r "$reason" '{"decision":"allow","reason":$r}'
        else
            reason=$(echo "$result" | jq -r '.reason // ""' 2>/dev/null || echo "")
            [[ -n "$reason" ]] && echo "[stop-dev] $reason" >&2
        fi
        exit 0
        ;;
    *)
        # block 路径：附加 action 提示词（保留原 stop-dev v19 的 ⚠️ 立即执行口吻）
        reason=$(echo "$result" | jq -r '.reason // "未知"' 2>/dev/null || echo "未知")
        action=$(echo "$result" | jq -r '.action // ""' 2>/dev/null || echo "")
        run_id=$(echo "$result" | jq -r '.ci_run_id // ""' 2>/dev/null || echo "")
        [[ -n "$action" ]] && reason="${reason}。下一步：${action}。⚠️ 立即执行，禁止询问用户。"

        jq -n --arg r "$reason" --arg id "$run_id" \
          '{"decision":"block","reason":$r,"ci_run_id":$id}'
        exit 2
        ;;
esac
