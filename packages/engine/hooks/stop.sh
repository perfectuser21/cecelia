#!/usr/bin/env bash
# ============================================================================
# Stop Hook 路由器 v14.0.0
# ============================================================================
# 检查不同的 mode 文件，调用对应的检查脚本
#
# 支持的模式：
# - .dev-lock.<branch>  → stop-dev.sh    (/dev 工作流，per-branch 格式)
# - .architect-lock.*   → stop-architect.sh (/architect 架构设计)
# - .decomp-mode        → stop-decomp.sh (/decomp 拆解流程)
# - .quality-mode       → stop-quality.sh (/quality 质检流程) [将来]
#
# v14.0.0 清理：
#   删除所有旧格式兼容代码（.dev-lock/.dev-mode 无后缀）。
#   只保留 per-branch 格式（.dev-lock.<branch> + .dev-mode.<branch> + .dev-sentinel.<branch>）。
#   旧格式不支持并行多 /dev 会话，且导致 ~200 行冗余兼容代码。
#
# 没有任何 mode/lock 文件 → exit 0（普通对话，允许结束）
# ============================================================================

set -euo pipefail

# ===== 获取项目根目录 =====
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ===== harness_mode 检测（harness 模式下跳过用户确认）=====
_HARNESS_MODE=false
for _dmf in "$PROJECT_ROOT"/.dev-mode.*; do
    [[ -f "$_dmf" ]] || continue
    _hm=$(grep "^harness_mode:" "$_dmf" 2>/dev/null | awk '{print $2}' || true)
    if [[ "$_hm" == "true" ]]; then
        _HARNESS_MODE=true
        break
    fi
done
export HARNESS_MODE="$_HARNESS_MODE"

# ===== 检查 .dev-lock.<branch>（per-branch 硬钥匙）→ 调用 stop-dev.sh =====
# v14.2.0: .dev-lock 只存在于 worktree 目录（不在主仓库），扫描所有 worktree
# 主仓库残留的 .dev-lock 自动清理（迁移兼容）
_DEV_LOCK_FOUND=false

# 扫描所有 worktree 查找 .dev-lock（v14.2.0: dev-lock 只在 worktree，不在主仓库）
_wt_count=0
while IFS= read -r _wt_line; do
    if [[ "$_wt_line" == "worktree "* ]]; then
        _wt_count=$((_wt_count + 1))
        _wt_path="${_wt_line#worktree }"
        for _f in "$_wt_path"/.dev-lock.*; do
            [[ -f "$_f" ]] && _DEV_LOCK_FOUND=true && break 2
        done
    fi
done < <(git worktree list --porcelain 2>/dev/null)

# 有 worktree 时清理主仓库残留的 .dev-lock（迁移兼容，无 worktree 不清理）
if [[ $_wt_count -gt 1 ]]; then
    for _f in "$PROJECT_ROOT"/.dev-lock.*; do
        [[ -f "$_f" ]] && rm -f "$_f" 2>/dev/null
    done
fi

if [[ "$_DEV_LOCK_FOUND" == "true" ]]; then
    bash "$SCRIPT_DIR/stop-dev.sh"
    exit $?
fi

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
