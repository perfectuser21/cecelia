#!/usr/bin/env bash
# ============================================================================
# stop-dev-v2.sh — cwd-as-key 原型（不接线，手工验证用）
# ============================================================================
# 设计原则：cwd = 所有权的唯一证据（无头 Claude 进程 cwd 永远是自己的 worktree）
# 对比 stop-dev.sh：313 行 → ~60 行
# 入口契约：stop.sh 解析 stdin JSON 后导出 CLAUDE_HOOK_CWD
# 完整设计：docs/superpowers/specs/2026-04-21-stop-dev-v2-cwd-as-key-design.md
# ============================================================================

set -euo pipefail

# ---- 契约 1：逃生通道 ----------------------------------------------------
if [[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]]; then
    echo "[stop-dev-v2] bypass via CECELIA_STOP_HOOK_BYPASS=1" >&2
    exit 0
fi

# ---- 契约 2：确定 cwd（fallback 到 $PWD） --------------------------------
cwd="${CLAUDE_HOOK_CWD:-$PWD}"
[[ ! -d "$cwd" ]] && exit 0

# ---- 2/3/4：推 worktree + branch -----------------------------------------
wt_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0

# 契约 3：主仓库/默认分支 → 放行
case "$branch" in
    main|master|develop|HEAD) exit 0 ;;
esac

# 契约 4：非 /dev 流程 → 放行
dev_mode="$wt_root/.dev-mode.$branch"
[[ ! -f "$dev_mode" ]] && exit 0

# ---- 加载 devloop-check SSOT ---------------------------------------------
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
devloop_lib=""
for c in \
    "$wt_root/packages/engine/lib/devloop-check.sh" \
    "$script_dir/../lib/devloop-check.sh" \
    "$HOME/.claude/lib/devloop-check.sh"; do
    [[ -f "$c" ]] && { devloop_lib="$c"; break; }
done
# shellcheck disable=SC1090
[[ -n "$devloop_lib" ]] && source "$devloop_lib"
command -v jq &>/dev/null || jq() { cat >/dev/null 2>&1; echo '{}'; }

# ---- 契约 5：格式异常 fail-closed ----------------------------------------
if ! head -1 "$dev_mode" 2>/dev/null | grep -q "^dev$"; then
    first_line=$(head -1 "$dev_mode" 2>/dev/null || echo "<empty>")
    jq -n --arg f "$dev_mode" --arg l "$first_line" \
      '{"decision":"block","reason":"dev-mode 格式异常（首行 [\($l)] 不是 dev）: \($f)。请删除该文件或修正为标准格式后重试。"}'
    exit 2
fi

# ---- 契约 6/7：调 devloop_check ------------------------------------------
if ! type devloop_check &>/dev/null; then
    jq -n '{"decision":"block","reason":"devloop-check.sh 未加载，fail-closed"}'
    exit 2
fi

result=$(devloop_check "$branch" "$dev_mode") || true
status=$(echo "$result" | jq -r '.status // "blocked"' 2>/dev/null || echo "blocked")

if [[ "$status" == "done" || "$status" == "merged" ]]; then
    rm -f "$dev_mode"
    jq -n '{"decision":"allow","reason":"PR 已合并且 Stage 4 完成"}'
    exit 0
fi

# 未完成 → block（reason 透传 devloop_check 返回）
reason=$(echo "$result" | jq -r '.reason // "未知"' 2>/dev/null || echo "未知")
action=$(echo "$result" | jq -r '.action // ""' 2>/dev/null || echo "")
run_id=$(echo "$result" | jq -r '.ci_run_id // ""' 2>/dev/null || echo "")
[[ -n "$action" ]] && reason="${reason}。下一步：${action}。⚠️ 立即执行，禁止询问用户。"

jq -n --arg r "$reason" --arg id "$run_id" \
  '{"decision":"block","reason":$r,"ci_run_id":$id}'
exit 2
