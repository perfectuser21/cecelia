#!/usr/bin/env bash
# ============================================================================
# stop-dev.sh — cwd-as-key（v19.0.0，彻底重写）
# ============================================================================
# 所有权证据 = cwd（无头 Claude 进程 cwd 永远是自己的 worktree；
# 交互 Claude hook stdin JSON 里的 cwd 字段就是当时 cwd）
#
# 替换掉老版 313 行的 session_id/tty/owner_session 多字段匹配 +
# self-heal + 跨 session orphan 隔离 + harness 分叉 + flock 并发锁。
#
# 入口契约：stop.sh 从 stdin JSON 解析 cwd 并 export CLAUDE_HOOK_CWD
# 业务 SSOT：devloop_check（判完成状态，不改）
# 完整设计：docs/superpowers/specs/2026-04-21-stop-hook-final-design.md
# ============================================================================

set -euo pipefail

# ---- 逃生通道 ------------------------------------------------------------
if [[ "${CECELIA_STOP_HOOK_BYPASS:-}" == "1" ]]; then
    echo "[stop-dev] bypass via CECELIA_STOP_HOOK_BYPASS=1" >&2
    exit 0
fi

# ---- 确定 cwd（stdin JSON 优先，fallback 到 ${PWD}） -----------------------
cwd="${CLAUDE_HOOK_CWD:-$PWD}"
[[ ! -d "$cwd" ]] && exit 0

# ---- 从 cwd 推 worktree + branch -----------------------------------------
wt_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0

# 主仓库/默认分支 → 放行（不打扰日常对话）
case "$branch" in
    main|master|develop|HEAD) exit 0 ;;
esac

# 非 /dev 流程（无 .dev-mode） → 放行
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

# ---- 格式校验 fail-closed ------------------------------------------------
if ! head -1 "$dev_mode" 2>/dev/null | grep -q "^dev$"; then
    first_line=$(head -1 "$dev_mode" 2>/dev/null || echo "<empty>")
    jq -n --arg f "$dev_mode" --arg l "$first_line" \
      '{"decision":"block","reason":"dev-mode 格式异常（首行 [\($l)] 不是 dev）: \($f)。请删除该文件或修正为标准格式后重试。"}'
    exit 2
fi

# ---- 调 devloop_check ----------------------------------------------------
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

# 未完成 → block（reason 透传）
reason=$(echo "$result" | jq -r '.reason // "未知"' 2>/dev/null || echo "未知")
action=$(echo "$result" | jq -r '.action // ""' 2>/dev/null || echo "")
run_id=$(echo "$result" | jq -r '.ci_run_id // ""' 2>/dev/null || echo "")
[[ -n "$action" ]] && reason="${reason}。下一步：${action}。⚠️ 立即执行，禁止询问用户。"

jq -n --arg r "$reason" --arg id "$run_id" \
  '{"decision":"block","reason":$r,"ci_run_id":$id}'
exit 2
