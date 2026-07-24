#!/usr/bin/env bash
# ============================================================================
# Stop Hook 路由器 v19.0.0
# ============================================================================
# 支持的模式：
# - .architect-lock.*   → stop-architect.sh (/architect 架构设计)
# - .decomp-mode        → stop-decomp.sh (/decomp 拆解流程)
# - .quality-mode       → stop-quality.sh (/quality 质检流程) [将来]
#
# v19.0.0 简化（配合 goal-based hook 替代）：
#   删除 stop-dev.sh 路由段。
#   /dev 工作流改用 goal-based hook 处理。
#   stop.sh 仅保留 architect/decomp 路由。
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

# ===== 检查 .conversation-mode → 调用 stop-conversation.sh =====
if [[ -f "$PROJECT_ROOT/.conversation-mode" ]]; then
    bash "$SCRIPT_DIR/stop-conversation.sh"
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
# Guard A（对齐 zombie-sweep.js/zombie-cleaner.js，2026-07-10 补）：
#   1. flock 互斥 —— 本机同时多个 worktree session 各自触发 stop.sh，全部无锁在同一份
#      共享 .git/worktrees 元数据上操作会互相撕坏（Brain 侧 startup-recovery.js 注释已言明此风险）
#   2. git status --porcelain 未提交改动检查 —— 非空则跳过，不强制删
#   3. .dev-lock.* / .dev-mode.* 活跃锁检查 —— 存在则跳过（活跃 dev session 不删）
#      判定逻辑抽取到 lib/worktree-guard.sh，与 tests/stop-worktree-guard.manual-test.sh 共用同一份
#      （2026-07-10 审查修复：此前测试脚本手抄了一份独立逻辑，与本文件不同步）
source "$SCRIPT_DIR/lib/worktree-guard.sh"
{
    _orphan_git_common="$(git -C "$PROJECT_ROOT" rev-parse --git-common-dir 2>/dev/null || echo "$PROJECT_ROOT/.git")"
    _orphan_lock_file="${_orphan_git_common}/stop-worktree-cleanup.lock"
    if command -v flock >/dev/null 2>&1; then
        exec 201>"${_orphan_lock_file}"
        flock -w 5 201 || exit 0
    fi

    _orphan_wt_path=""
    while IFS= read -r _orphan_line; do
        if [[ "$_orphan_line" == "worktree "* ]]; then
            _orphan_wt_path="${_orphan_line#worktree }"
        elif [[ "$_orphan_line" == "branch "* ]]; then
            _orphan_wt_branch="${_orphan_line#branch refs/heads/}"
            # 跳过主仓库自身（不清理主仓库）
            [[ "$_orphan_wt_path" == "$PROJECT_ROOT" ]] && continue
            # 跳过有活跃锁（.dev-lock.* / .dev-mode.*）或未提交改动的 worktree
            # （不强制删活跃 dev session 正在用的 worktree）
            if stop_hook_should_skip_worktree "$_orphan_wt_path" >/dev/null; then
                continue
            fi
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

# ===== decision_saved 协议对账（PR4 主理人对话回路硬闸）=====
# 扫描本次会话转录，验证所有 [TURN: decision_saved=<uuid>] 标记确实写入了 decisions 表。
# 不判语义，只对账协议 —— 仿收账权收归哲学（decision d33bb636/design⑧a）。
# Brain 不可达时跳过（网络原因不阻断工作流）。
if [[ -n "${CLAUDE_HOOK_TRANSCRIPT_PATH:-}" && -f "${CLAUDE_HOOK_TRANSCRIPT_PATH}" ]]; then
    _BRAIN_OK=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 --max-time 4 \
      "http://localhost:5221/api/brain/tasks?limit=1" 2>/dev/null || echo "000")
    if [[ "$_BRAIN_OK" == "200" ]]; then
        # UUID v4 模式：8-4-4-4-12 十六进制
        _UUID_RE='decision_saved=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        _CLAIMED_IDS=$(grep -oE "$_UUID_RE" "${CLAUDE_HOOK_TRANSCRIPT_PATH}" 2>/dev/null \
          | sed 's/decision_saved=//' | sort -u)
        for _DID in $_CLAIMED_IDS; do
            _DEC_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 --max-time 5 \
              "http://localhost:5221/api/brain/decisions/${_DID}" 2>/dev/null || echo "000")
            if [[ "$_DEC_STATUS" != "200" ]]; then
                echo "⛔ [TURN] decision_saved=${_DID} 已声明但 Brain DB 查无此 id（HTTP ${_DEC_STATUS}）。"
                echo "   请检查 decision 是否写入成功，或移除错误的 [TURN: decision_saved=...] 标记后重试。"
                exit 2
            fi
        done
    fi
fi

# ===== 没有任何 mode 文件 → 普通对话，允许结束 =====
exit 0
# v14.0.0: Unified per-branch format
