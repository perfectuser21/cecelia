#!/usr/bin/env bash
# ============================================================================
# Stop Hook: 循环控制器（官方 JSON API 实现）
# ============================================================================
# 检测 .dev-mode 文件，根据完成条件决定是否允许会话结束：
#
# 无 .dev-mode → exit 0（普通会话，允许结束）
# 有 .dev-mode → 检查完成条件：
#   - PR 创建？
#   - CI 通过？
#   - PR 合并？
#   全部满足 → 删除 .dev-mode → exit 0
#   未满足 → JSON API + exit 2（强制循环，reason 作为 prompt 继续执行）
#
# v11.11.0: P0-2 修复 - 添加 flock 并发锁 + 原子写入防止竞态条件
# v11.15.0: P0-3 修复 - 会话隔离，检查 .dev-mode 中的分支是否与当前分支匹配
# v11.16.0: P0-4 修复 - session_id 验证 + 共享锁工具库 + 统一 CI 查询
# v11.18.0: H7-008 - TTY 会话隔离，有头模式下按 terminal 隔离
# v11.25.0: H7-009 - JSON API 实现（{"decision": "block", "reason": "..."}），15 次重试上限
# ============================================================================

set -euo pipefail

# ===== 无头模式：不再旁路，与有头模式使用同一套状态机 =====
# Headless 也必须检查 .dev-mode：
#   - 有 .dev-mode → exit 2 继续循环
#   - 无 .dev-mode → exit 0 允许结束
# （后续会统一检查 .dev-mode，这里不做特殊处理）

# ===== 加载共享库 =====
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT_EARLY="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# 尝试加载 lock-utils（项目内 > 全局）
LOCK_UTILS=""
for candidate in "$PROJECT_ROOT_EARLY/lib/lock-utils.sh" "$SCRIPT_DIR/../lib/lock-utils.sh" "$HOME/.claude/lib/lock-utils.sh"; do
    if [[ -f "$candidate" ]]; then
        LOCK_UTILS="$candidate"
        break
    fi
done

# 尝试加载 ci-status（项目内 > 全局）
CI_STATUS_LIB=""
for candidate in "$PROJECT_ROOT_EARLY/lib/ci-status.sh" "$SCRIPT_DIR/../lib/ci-status.sh" "$HOME/.claude/lib/ci-status.sh"; do
    if [[ -f "$candidate" ]]; then
        CI_STATUS_LIB="$candidate"
        break
    fi
done

# shellcheck disable=SC1090
[[ -n "$LOCK_UTILS" ]] && source "$LOCK_UTILS"
# shellcheck disable=SC1090
[[ -n "$CI_STATUS_LIB" ]] && source "$CI_STATUS_LIB"

# ===== P0-2 修复：获取并发锁，防止多个会话同时操作 =====
if [[ -n "$LOCK_UTILS" ]] && type acquire_dev_mode_lock &>/dev/null; then
    if ! acquire_dev_mode_lock 2; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [Stop Hook: 并发锁获取失败]" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "  另一个会话正在执行 Stop Hook，请稍后重试" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        jq -n --arg reason "另一个会话正在执行 Stop Hook，等待锁释放后继续检查完成条件" '{"decision": "block", "reason": $reason}'
        exit 2
    fi
else
    # Fallback: 内联锁
    LOCK_DIR="$(git rev-parse --show-toplevel 2>/dev/null)/.git" || LOCK_DIR="/tmp"
    LOCK_FILE="$LOCK_DIR/cecelia-stop.lock"
    exec 200>"$LOCK_FILE"
    if ! flock -w 2 200; then
        echo "" >&2
        echo "  [Stop Hook: 并发锁获取失败]" >&2
        jq -n --arg reason "并发锁获取失败，等待锁释放后继续" '{"decision": "block", "reason": $reason}'
        exit 2
    fi
fi

# ===== 读取 Hook 输入（JSON） =====
HOOK_INPUT=$(cat)

# ===== 15 次重试计数器（替代旧的 stop_hook_active 检查）=====
# 此处不再检查 stop_hook_active，改为在 .dev-mode 中维护 retry_count
# 具体检查逻辑在后面的完成条件中处理

# ===== 获取项目根目录 =====
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ===== Helper: 强制清理 worktree（兜底）=====
force_cleanup_worktree() {
    local mode_file="$1"
    local branch
    branch=$(grep "^branch:" "$mode_file" 2>/dev/null | awk '{print $2}')
    if [[ -z "$branch" ]]; then
        return 0
    fi
    local wt_path
    wt_path=$(git worktree list 2>/dev/null | grep "\[$branch\]" | awk '{print $1}')
    local main_wt
    main_wt=$(git worktree list 2>/dev/null | head -1 | awk '{print $1}')
    if [[ -n "$wt_path" && "$wt_path" != "$main_wt" ]]; then
        # cd 到主仓库再删除，避免 git 拒绝删除当前 CWD 所在的 worktree
        (cd "$main_wt" && git worktree remove "$wt_path" --force 2>/dev/null) || true
        (cd "$main_wt" && git worktree prune 2>/dev/null) || true
    fi
}

# ===== Helper: 保存阻塞原因到 .dev-mode =====
save_block_reason() {
    local reason="$1"
    local mode_file="$DEV_MODE_FILE"
    [[ -n "$mode_file" && -f "$mode_file" ]] || return 0
    {
        flock -x 201
        grep -v "^last_block_reason:" "$mode_file" > "$mode_file.reason.tmp" 2>/dev/null || true
        echo "last_block_reason: $reason" >> "$mode_file.reason.tmp"
        mv "$mode_file.reason.tmp" "$mode_file"
    } 201>"$mode_file.reason.lock" 2>/dev/null || {
        if [[ "$(uname)" == "Darwin" ]]; then
            sed -i '' "/^last_block_reason:/d" "$mode_file" 2>/dev/null || true
        else
            sed -i "/^last_block_reason:/d" "$mode_file" 2>/dev/null || true
        fi
        echo "last_block_reason: $reason" >> "$mode_file"
    }
}

# ===== 检查 .dev-lock 和 .dev-mode 文件（双钥匙状态机）=====
# v12.9.0: 双钥匙修复 - .dev-lock（硬钥匙）+ .dev-mode（软状态）+ sentinel（三重保险）
# v12.36.0: 并行会话隔离 - .dev-lock.<branch> 格式，多会话互不干扰
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# ===== 动态发现当前会话的状态文件 =====
# 优先查找 per-branch 格式（.dev-lock.<branch>），fallback 到旧格式（.dev-lock）
_CURRENT_TTY=$(tty 2>/dev/null || echo "")
_CURRENT_SESSION_ID="${CLAUDE_SESSION_ID:-}"
DEV_LOCK_FILE=""
DEV_MODE_FILE=""
SENTINEL_FILE=""

# 扫描所有 per-branch lock 文件，找属于当前会话的
for _lock_file in "$PROJECT_ROOT"/.dev-lock.*; do
    [[ -f "$_lock_file" ]] || continue
    _lock_tty=$(grep "^tty:" "$_lock_file" 2>/dev/null | cut -d' ' -f2- | xargs 2>/dev/null || echo "")
    _lock_session=$(grep "^session_id:" "$_lock_file" 2>/dev/null | cut -d' ' -f2 | xargs 2>/dev/null || echo "")
    _branch_in_lock=$(grep "^branch:" "$_lock_file" 2>/dev/null | cut -d' ' -f2 | xargs 2>/dev/null || echo "")
    _matched=false

    # TTY 匹配（有头模式首选）
    if [[ -n "$_lock_tty" && "$_lock_tty" != "not a tty" && -n "$_CURRENT_TTY" && "$_CURRENT_TTY" != "not a tty" ]]; then
        if [[ "$_lock_tty" == "$_CURRENT_TTY" ]]; then
            _matched=true
        fi
    # session_id 匹配（TTY 不可用时 fallback）
    elif [[ -n "$_lock_session" && -n "$_CURRENT_SESSION_ID" && "$_lock_session" == "$_CURRENT_SESSION_ID" ]]; then
        _matched=true
    fi

    if [[ "$_matched" == "true" && -n "$_branch_in_lock" ]]; then
        DEV_LOCK_FILE="$_lock_file"
        DEV_MODE_FILE="$PROJECT_ROOT/.dev-mode.${_branch_in_lock}"
        SENTINEL_FILE="$PROJECT_ROOT/.dev-sentinel.${_branch_in_lock}"
        break
    fi
done

# 旧格式向后兼容：没有找到 per-branch 文件时，检查 .dev-lock（无后缀）
if [[ -z "$DEV_LOCK_FILE" && -f "$PROJECT_ROOT/.dev-lock" ]]; then
    DEV_LOCK_FILE="$PROJECT_ROOT/.dev-lock"
    DEV_MODE_FILE="$PROJECT_ROOT/.dev-mode"
    SENTINEL_FILE="$PROJECT_ROOT/.dev-sentinel"
fi

# Key-1: .dev-lock（硬钥匙）- 只要它在，就必须走 dev 检查
if [[ -z "$DEV_LOCK_FILE" ]]; then
    # 没有匹配的 .dev-lock → 检查孤儿 .dev-mode.* 文件（泄漏清理）
    for _orphan_mode in "$PROJECT_ROOT"/.dev-mode.*; do
        [[ -f "$_orphan_mode" ]] || continue
        _orphan_branch=$(grep "^branch:" "$_orphan_mode" 2>/dev/null | cut -d' ' -f2 || echo "")
        _orphan_lock="$PROJECT_ROOT/.dev-lock.${_orphan_branch}"
        if [[ -n "$_orphan_branch" && ! -f "$_orphan_lock" ]]; then
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "  [Stop Hook: 状态文件泄漏（孤儿 .dev-mode）]" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "" >&2
            echo "  ⚠️  .dev-lock.${_orphan_branch} 不存在但 .dev-mode 存在（泄漏）" >&2
            echo "  清理泄漏文件..." >&2
            force_cleanup_worktree "$_orphan_mode" || true
            rm -f "$_orphan_mode" "$PROJECT_ROOT/.dev-sentinel.${_orphan_branch}"
            echo "  ✅ 已清理" >&2
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        fi
    done

    # 旧格式泄漏检查
    if [[ -f "$PROJECT_ROOT/.dev-mode" ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [Stop Hook: 状态文件泄漏]" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "  ⚠️  .dev-lock 不存在但 .dev-mode 存在（泄漏）" >&2
        echo "  清理泄漏的 .dev-mode 文件..." >&2
        force_cleanup_worktree "$PROJECT_ROOT/.dev-mode" || true
        rm -f "$PROJECT_ROOT/.dev-mode" "$PROJECT_ROOT/.dev-sentinel"
        echo "  ✅ 已清理" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    fi

    # 检查 sentinel（三重保险）—— 仅旧格式
    if [[ -f "$PROJECT_ROOT/.dev-sentinel" ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [Stop Hook: Sentinel 检测到状态丢失]" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "  ⚠️  Sentinel 存在但 .dev-lock 和 .dev-mode 都不存在" >&2
        echo "  可能原因：状态文件被误删或同时删除" >&2
        echo "" >&2
        echo "  下一步：重建状态文件或检查清理脚本" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        jq -n --arg reason "Sentinel 存在但状态文件丢失，判定为误删，阻止退出" '{"decision": "block", "reason": $reason}'
        exit 2  # ← 强制阻止退出（三重保险生效）
    fi

    # 没有任何 dev 状态文件 → 普通会话，允许结束
    exit 0
fi

# .dev-lock 存在，检查 .dev-mode（软状态）
if [[ ! -f "$DEV_MODE_FILE" ]]; then
    # .dev-lock 在但 .dev-mode 不在 → 状态丢失/创建失败/被删除
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [Stop Hook: 状态文件丢失]" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "  ⚠️  .dev-lock 存在但 .dev-mode 缺失" >&2
    echo "  可能原因:" >&2
    echo "    - .dev-mode 创建失败（Write 工具 git 污染）" >&2
    echo "    - .dev-mode 被误删（cleanup.sh / 手动 rm / AI）" >&2
    echo "" >&2
    echo "  下一步：重建 .dev-mode 或执行最小检查" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    jq -n --arg reason ".dev-lock 存在但 .dev-mode 缺失，阻止退出（状态丢失或创建失败）" '{"decision": "block", "reason": $reason}'
    exit 2  # ← 强制阻止退出（双钥匙核心机制）
fi

# ===== 检查 cleanup 是否已完成 =====
# 优先检查 cleanup_done: true（向后兼容旧版本）
if grep -q "cleanup_done: true" "$DEV_MODE_FILE" 2>/dev/null; then
    force_cleanup_worktree "$DEV_MODE_FILE"
    rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE" "$SENTINEL_FILE"
    exit 0
fi

# v12.8.0: 删除了"11步全部done"的提前退出逻辑
#
# 问题：步骤状态可能被错误标记（如 CI 未通过但 step_9_ci 被标记为 done），
#       导致 Stop Hook 在实际 CI 检查之前就认为"完成"并退出
#
# 修复：步骤状态（step_*）只用于进度展示（TaskList），不用于流程控制
#       流程控制只依赖实际状态检查：PR 创建 → CI 通过 → PR 合并 → cleanup_done
#
# 详见：.prd-cp-02071917-stop-hook-fix.md

# ===== 检查重试次数（15 次上限）=====
# Bug fix: 使用 awk 替代 cut，避免多空格问题
RETRY_COUNT=$(grep "^retry_count:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "0")
RETRY_COUNT=${RETRY_COUNT//[^0-9]/}  # 清理非数字字符
RETRY_COUNT=${RETRY_COUNT:-0}        # 空值默认为 0

# Bug fix: 先递增计数器，再检查上限（修复 off-by-one 错误）
# 原逻辑：检查 >= 15 后才递增，导致实际第 16 次才失败
RETRY_COUNT=$((RETRY_COUNT + 1))

if [[ $RETRY_COUNT -gt 15 ]]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [Stop Hook: 15 次重试上限]" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "  已重试 15 次，任务失败" >&2
    echo "  原因：15 次重试后仍未完成 11 步流程" >&2
    echo "" >&2

    # 上报失败
    TRACK_SCRIPT="$PROJECT_ROOT/skills/dev/scripts/track.sh"
    if [[ -f "$TRACK_SCRIPT" ]]; then
        bash "$TRACK_SCRIPT" fail "Stop Hook 重试 15 次后仍未完成" 2>/dev/null || true
    fi

    # 写入失败日志（.dev-failure.log）
    FAILURE_LOG="$PROJECT_ROOT/.dev-failure.log"
    FAIL_BRANCH=$(grep "^branch:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "unknown")
    LAST_REASON=$(grep "^last_block_reason:" "$DEV_MODE_FILE" 2>/dev/null | sed 's/^last_block_reason: //' || echo "unknown")
    {
        echo "=== Dev Failure Log ==="
        echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%S+00:00)"
        echo "branch: $FAIL_BRANCH"
        echo "retry_count: $RETRY_COUNT"
        echo "last_block_reason: $LAST_REASON"
        echo "========================"
    } > "$FAILURE_LOG"

    # 强制清理 worktree（兜底）
    force_cleanup_worktree "$DEV_MODE_FILE"

    # 删除 .dev-mode, .dev-lock, sentinel 文件
    rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE" "$SENTINEL_FILE"

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 0  # 允许会话结束（失败退出）
fi

# 更新重试次数（Bug fix: 原子更新 + 跨平台 sed 兼容）
# 注意: RETRY_COUNT 已在上面递增，这里直接写入当前值
{
    flock -x 200
    grep -v "^retry_count:" "$DEV_MODE_FILE" > "$DEV_MODE_FILE.tmp" 2>/dev/null || true
    echo "retry_count: $RETRY_COUNT" >> "$DEV_MODE_FILE.tmp"
    mv "$DEV_MODE_FILE.tmp" "$DEV_MODE_FILE"
} 200>"$DEV_MODE_FILE.lock" 2>/dev/null || {
    # flock 失败时的 fallback（不中断流程）
    # Bug fix: 使用跨平台兼容的 sed 语法（macOS 和 Linux）
    # macOS sed -i 需要 '' 参数，Linux 不需要
    if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' "/^retry_count:/d" "$DEV_MODE_FILE" 2>/dev/null || true
    else
        sed -i "/^retry_count:/d" "$DEV_MODE_FILE" 2>/dev/null || true
    fi
    echo "retry_count: $RETRY_COUNT" >> "$DEV_MODE_FILE"
}

# ===== 读取 .dev-mode 内容 =====
DEV_MODE=$(head -1 "$DEV_MODE_FILE" 2>/dev/null || echo "")
BRANCH_IN_FILE=$(grep "^branch:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2 || echo "")

# 如果不是 dev 模式 — .dev-lock 存在但 .dev-mode 首行被损坏
# 安全默认：阻止退出（exit 2），不能静默放行
# PR #550 修复：之前 exit 0 导致状态文件写坏时 Stop Hook 完全失效
if [[ "$DEV_MODE" != "dev" ]]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [Stop Hook: .dev-mode 首行损坏]" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "  期望首行: dev" >&2
    echo "  实际首行: $DEV_MODE" >&2
    echo "  文件: $DEV_MODE_FILE" >&2
    echo "" >&2
    echo "  .dev-lock 存在说明 /dev 在运行中" >&2
    echo "  .dev-mode 首行损坏 → 安全默认阻止退出" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    save_block_reason ".dev-mode 首行损坏（期望 dev，实际 $DEV_MODE）"
    jq -n --arg reason ".dev-mode 首行损坏（期望 'dev'，实际 '$DEV_MODE'）。.dev-lock 存在说明 /dev 在运行中，安全默认阻止退出。请重建 .dev-mode 文件：第一行必须是 'dev'，后跟 branch/session_id 等字段。" '{"decision": "block", "reason": $reason}'
    exit 2
fi

# ===== P0-3 修复：会话隔离 - 检查分支是否匹配 =====
# 获取当前分支
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# 如果 .dev-mode 中的分支与当前分支不匹配，删除泄漏的 .dev-mode 文件
# 这防止多个 Claude 会话"串线"（一个会话被迫接手另一个会话的任务）
if [[ -n "$BRANCH_IN_FILE" && "$BRANCH_IN_FILE" != "$CURRENT_BRANCH" ]]; then
    # 分支不匹配，说明 .dev-mode 泄漏了，删除它
    echo "  ⚠️  检测到泄漏的 .dev-mode 文件（分支 $BRANCH_IN_FILE，当前 $CURRENT_BRANCH）" >&2
    echo "  🧹 删除泄漏文件..." >&2
    rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE" "$SENTINEL_FILE"
    exit 0
fi

# ===== H7-008：TTY 隔离 - 有头模式下按 terminal 隔离 =====
TTY_IN_FILE=$(grep "^tty:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2- || echo "")
CURRENT_TTY=$(tty 2>/dev/null || echo "")

# 如果 .dev-mode 有有效 tty 字段且当前 TTY 可获取，检查是否匹配
if [[ -n "$TTY_IN_FILE" && "$TTY_IN_FILE" != "not a tty" && -n "$CURRENT_TTY" && "$CURRENT_TTY" != "not a tty" && "$TTY_IN_FILE" != "$CURRENT_TTY" ]]; then
    # 不是当前 terminal 的任务，允许结束
    exit 0
fi

# ===== P0-4 修复：session_id 验证 - 同分支多会话隔离 =====
SESSION_ID_IN_FILE=$(grep "^session_id:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2 || echo "")
CURRENT_SESSION_ID="${CLAUDE_SESSION_ID:-}"

# 如果 .dev-mode 有 session_id 且当前会话有 session_id，检查是否匹配
if [[ -n "$SESSION_ID_IN_FILE" && -n "$CURRENT_SESSION_ID" && "$SESSION_ID_IN_FILE" != "$CURRENT_SESSION_ID" ]]; then
    # 不是当前会话创建的任务，允许结束
    exit 0
fi

# 使用文件中的分支名（如果有），否则使用当前分支
BRANCH_NAME="${BRANCH_IN_FILE:-$CURRENT_BRANCH}"

echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  [Stop Hook: /dev 完成条件检查]" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2
echo "  分支: $BRANCH_NAME" >&2
echo "" >&2

# ===== 条件 1: PR 创建？ =====
PR_NUMBER=""
PR_STATE=""

if command -v gh &>/dev/null; then
    # 先检查 open 状态的 PR
    PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --state open --json number -q '.[0].number' 2>/dev/null || echo "")

    if [[ -n "$PR_NUMBER" ]]; then
        PR_STATE="open"
    else
        # 检查已合并的 PR
        PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --state merged --json number -q '.[0].number' 2>/dev/null || echo "")
        if [[ -n "$PR_NUMBER" ]]; then
            PR_STATE="merged"
        fi
    fi
fi

if [[ -z "$PR_NUMBER" ]]; then
    echo "  ❌ 条件 1: PR 未创建" >&2
    echo "" >&2
    echo "  下一步: 创建 PR" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    save_block_reason "PR 未创建"
    jq -n --arg reason "PR 未创建，继续执行 Step 8 创建 PR" '{"decision": "block", "reason": $reason}'
    exit 2
fi

echo "  ✅ 条件 1: PR 已创建 (#$PR_NUMBER)" >&2

# ===== 不再提前退出，即使 PR 已合并也继续检查 cleanup_done =====
# 删除了原来的 PR 合并提前退出逻辑（Line 217-253）
# 现在即使 PR 合并，也必须等待 Step 11 Cleanup 完成并设置 cleanup_done: true

# ===== 条件 2: CI 状态？（PR 未合并时检查） =====
CI_STATUS="unknown"
CI_CONCLUSION=""
CI_RUN_ID=""

# P0-4: 使用统一 CI 查询库（带重试），fallback 到内联查询
if [[ -n "$CI_STATUS_LIB" ]] && type get_ci_status &>/dev/null; then
    CI_RESULT=$(CI_MAX_RETRIES=2 CI_RETRY_DELAY=3 get_ci_status "$BRANCH_NAME") || true
    CI_STATUS=$(echo "$CI_RESULT" | jq -r '.status // "unknown"')
    CI_CONCLUSION=$(echo "$CI_RESULT" | jq -r '.conclusion // ""')
    CI_RUN_ID=$(echo "$CI_RESULT" | jq -r '.run_id // ""')
else
    # Fallback: 内联查询
    RUN_INFO=$(gh run list --branch "$BRANCH_NAME" --limit 1 --json status,conclusion,databaseId 2>/dev/null || echo "[]")
    if [[ "$RUN_INFO" != "[]" && -n "$RUN_INFO" ]]; then
        CI_STATUS=$(echo "$RUN_INFO" | jq -r '.[0].status // "unknown"')
        CI_CONCLUSION=$(echo "$RUN_INFO" | jq -r '.[0].conclusion // ""')
        CI_RUN_ID=$(echo "$RUN_INFO" | jq -r '.[0].databaseId // ""')
    fi
fi

case "$CI_STATUS" in
    "completed")
        if [[ "$CI_CONCLUSION" == "success" ]]; then
            echo "  ✅ 条件 2: CI 通过" >&2
        else
            echo "  ❌ 条件 2: CI 失败 ($CI_CONCLUSION)" >&2
            echo "" >&2
            echo "  下一步: 查看 CI 日志并修复" >&2
            if [[ -n "$CI_RUN_ID" ]]; then
                echo "    gh run view $CI_RUN_ID --log-failed" >&2
            fi
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            save_block_reason "CI 失败 ($CI_CONCLUSION)"
            jq -n --arg reason "CI 失败（$CI_CONCLUSION），查看日志修复问题后重新 push" --arg run_id "${CI_RUN_ID:-unknown}" '{"decision": "block", "reason": $reason, "ci_run_id": $run_id}'
            exit 2
        fi
        ;;
    "in_progress"|"queued"|"waiting"|"pending")
        echo "  ⏳ 条件 2: CI 进行中 ($CI_STATUS)" >&2
        echo "" >&2
        echo "  下一步: 等待 CI 完成" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        save_block_reason "CI 进行中 ($CI_STATUS)"
        jq -n --arg reason "CI 进行中（$CI_STATUS），等待 CI 完成" '{"decision": "block", "reason": $reason}'
        exit 2
        ;;
    *)
        echo "  ⚠️  条件 2: CI 状态未知 ($CI_STATUS)" >&2
        echo "" >&2
        echo "  下一步: 检查 CI 状态" >&2
        echo "    gh run list --branch $BRANCH_NAME --limit 1" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        save_block_reason "CI 状态未知 ($CI_STATUS)"
        jq -n --arg reason "CI 状态未知（$CI_STATUS），检查 CI 状态" '{"decision": "block", "reason": $reason}'
        exit 2
        ;;
esac

# ===== 条件 3: PR 已合并？（CI 通过后检查） =====
if [[ "$PR_STATE" == "merged" ]]; then
    echo "  ✅ 条件 3: PR 已合并" >&2

    # 检查是否完成 Step 11 Cleanup
    # Bug fix: 使用 awk 提取状态值，避免匹配其他内容
    STEP_11_STATUS=$(grep "^step_11_cleanup:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "pending")
    if [[ "$STEP_11_STATUS" == "done" ]]; then
        echo "  ✅ Step 11 Cleanup 已完成" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  🎉 工作流完成！正在清理..." >&2
        force_cleanup_worktree "$DEV_MODE_FILE"
        rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE" "$SENTINEL_FILE"
        jq -n '{"decision": "allow", "reason": "PR 已合并且 Step 11 完成，工作流结束"}'
        exit 0  # 允许结束
    else
        echo "  ⚠️  Step 11 Cleanup 未完成" >&2
        echo "" >&2
        echo "  下一步: 执行 Step 11 Cleanup" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        save_block_reason "PR 已合并，Cleanup 未完成"
        jq -n '{"decision": "block", "reason": "PR 已合并，执行 Step 11 Cleanup"}'
        exit 2
    fi
else
    # PR 未合并
    echo "  ❌ 条件 3: PR 未合并" >&2

    # ===== v12.35.8: 合并前检查 Step 10 LEARNINGS =====
    # 必须先完成 Step 10（写 LEARNINGS → push 到功能分支），再合并 PR
    # 否则 AI 合并后功能分支被删，LEARNINGS 无处 push，被迫另开 PR
    STEP_10_STATUS=$(grep "^step_10_learning:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "pending")
    if [[ "$STEP_10_STATUS" != "done" ]]; then
        echo "  ⚠️  Step 10 LEARNINGS 未完成（不能先合并 PR）" >&2
        echo "" >&2
        echo "  下一步: 先执行 Step 10 LEARNINGS" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        save_block_reason "Step 10 LEARNINGS 未完成（合并前必须先写 LEARNINGS）"
        jq -n --arg reason "CI 通过，但 Step 10 LEARNINGS 尚未完成。必须先：1) 读取 skills/dev/steps/10-learning.md 2) 写 docs/LEARNINGS.md 3) git add + commit + push 到功能分支（PR 自动更新）4) 写完后 stop-dev.sh 会自动放行合并。不要跳过 Step 10 直接合并。" '{"decision": "block", "reason": $reason}'
        exit 2
    fi

    echo "" >&2
    echo "  下一步: 合并 PR（Step 10 已完成）" >&2
    echo "    gh pr merge $PR_NUMBER --squash --delete-branch" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    save_block_reason "PR 未合并 (#$PR_NUMBER)"
    jq -n --arg reason "PR #$PR_NUMBER CI 已通过且 Step 10 LEARNINGS 已完成，执行合并操作：gh pr merge $PR_NUMBER --squash --delete-branch" --arg pr "$PR_NUMBER" '{"decision": "block", "reason": $reason, "pr_number": $pr}'
    exit 2
fi
