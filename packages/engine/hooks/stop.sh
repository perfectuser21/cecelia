#!/usr/bin/env bash
# ============================================================================
# Stop Hook 路由器 v19.0.0
# ============================================================================
# 支持的模式：
# - .dev-mode.<branch>  → stop-dev.sh    (/dev 工作流，cwd-as-key)
# - .architect-lock.*   → stop-architect.sh (/architect 架构设计)
# - .decomp-mode        → stop-decomp.sh (/decomp 拆解流程)
# - .quality-mode       → stop-quality.sh (/quality 质检流程) [将来]
#
# v19.0.0 简化（配合 stop-dev.sh v19 cwd-as-key 切线）：
#   删除 L84-112 的 .dev-lock session_id 精确匹配路由段。
#   stop-dev.sh 改为 cwd-as-key：由 stop-dev.sh 自行判断当前 cwd 是否在 /dev 流程。
#   stop.sh 无条件调用 stop-dev.sh，不再依赖 .dev-lock 文件存在性做路由。
#   设计文档：docs/superpowers/specs/2026-04-21-stop-hook-final-design.md
# ============================================================================

set -euo pipefail

# ===== v17.0.0: 从 stdin 读 Claude Code hook JSON =====
# Claude Code 通过 stdin JSON 传 session_id/transcript_path/cwd/stop_hook_active
# （不是 env var，之前 stop-dev.sh 用 $CLAUDE_SESSION_ID 永远是空的）
# 实测验证 2.1.114：env var 全空，stdin JSON 有 session_id
# CLAUDE_HOOK_STDIN_JSON_OVERRIDE: test 专用逃生（vitest spawn stdin 不稳定，允许 env 注入）
if [[ -n "${CLAUDE_HOOK_STDIN_JSON_OVERRIDE:-}" ]]; then
    _STOP_HOOK_STDIN="$CLAUDE_HOOK_STDIN_JSON_OVERRIDE"
else
    _STOP_HOOK_STDIN=$(cat 2>/dev/null || echo '{}')
fi
[[ -z "$_STOP_HOOK_STDIN" ]] && _STOP_HOOK_STDIN='{}'
_parse_json_field() {
    # 最小 JSON 提取，不依赖 jq（hook 必须极快）
    local key="$1" json="$2"
    echo "$json" | grep -oE "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | sed -E "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/" | head -1
}
export CLAUDE_HOOK_SESSION_ID="$(_parse_json_field session_id "$_STOP_HOOK_STDIN")"
export CLAUDE_HOOK_TRANSCRIPT_PATH="$(_parse_json_field transcript_path "$_STOP_HOOK_STDIN")"
export CLAUDE_HOOK_CWD="$(_parse_json_field cwd "$_STOP_HOOK_STDIN")"
export CLAUDE_HOOK_STDIN_JSON="$_STOP_HOOK_STDIN"

# ===== 获取项目根目录 =====
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ===== v19.0.0: 无条件调用 stop-dev.sh（cwd-as-key，由 stop-dev.sh 自判）=====
# stop-dev.sh 用 CLAUDE_HOOK_CWD（已由上方解析）确定 worktree + branch
# 主仓库/无 .dev-mode 场景由 stop-dev.sh 内部放行（exit 0）
bash "$SCRIPT_DIR/stop-dev.sh"
_stop_dev_exit=$?
# stop-dev.sh exit 2 = block，直接传给 Claude Code
[[ $_stop_dev_exit -ne 0 ]] && exit $_stop_dev_exit

# ===== 检查 .architect-lock.* → 调用 stop-architect.sh =====
_ARCHITECT_LOCK_FOUND=false
for _f in "$PROJECT_ROOT"/.architect-lock.*; do
    [[ -f "$_f" ]] && _ARCHITECT_LOCK_FOUND=true && break
done

if [[ "$_ARCHITECT_LOCK_FOUND" == "true" ]]; then
    bash "$SCRIPT_DIR/stop-architect.sh"
    exit $?
fi

# ===== 检查 .decomp-mode → 调用 stop-decomp.sh =====
if [[ -f "$PROJECT_ROOT/.decomp-mode" ]]; then
    bash "$SCRIPT_DIR/stop-decomp.sh"
    exit $?
fi

# ===== 检查 .quality-mode → 调用 stop-quality.sh =====
# 将来添加
# if [[ -f "$PROJECT_ROOT/.quality-mode" ]]; then
#     bash "$SCRIPT_DIR/stop-quality.sh"
#     exit $?
# fi

# ===== 触发对话结束 summary（fire-and-forget，不阻塞）=====
# conversation-consolidator 写入 memory_stream，让 Brain 记住本次对话
curl -s --connect-timeout 5 --max-time 10 -X POST "http://localhost:5221/api/brain/conversation-summary" \
  -H "Content-Type: application/json" \
  -d '{"trigger":"session_end"}' > /dev/null 2>&1 &
disown $! 2>/dev/null || true

# ===== 孤儿 Worktree 自动清理（已合并 PR → git worktree remove，失败不阻塞）=====
# 遍历所有 git worktree，检测对应 PR 是否已 merged，是则自动清理孤儿 worktree
{
    _orphan_wt_path=""
    while IFS= read -r _orphan_line; do
        if [[ "$_orphan_line" == "worktree "* ]]; then
            _orphan_wt_path="${_orphan_line#worktree }"
        elif [[ "$_orphan_line" == "branch "* ]]; then
            _orphan_wt_branch="${_orphan_line#branch refs/heads/}"
            # 跳过主仓库自身（不清理主仓库）
            [[ "$_orphan_wt_path" == "$PROJECT_ROOT" ]] && continue
            # 检查该 worktree 对应的 PR 是否已 merged
            _orphan_pr_state=$(gh pr view "$_orphan_wt_branch" --json state --jq '.state' 2>/dev/null || echo "")
            if [[ "$_orphan_pr_state" == "MERGED" ]]; then
                # git worktree remove 失败不阻塞 hook（|| true）
                git worktree remove --force "$_orphan_wt_path" 2>/dev/null || \
                    echo "[Stop Hook] worktree remove 失败（已忽略）: $_orphan_wt_path" >&2 || true
                echo "[Stop Hook] 已清理已合并 PR 孤儿 worktree: $_orphan_wt_branch" >&2
            fi
        fi
    done < <(git -C "$PROJECT_ROOT" worktree list --porcelain 2>/dev/null)
} &
disown $! 2>/dev/null || true

# ===== 没有任何 mode 文件 → 普通对话，允许结束 =====
exit 0
# v14.0.0: Unified per-branch format
