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
#   未满足 → JSON API + exit 0（强制循环，reason 作为 prompt 继续执行）
#
# v11.11.0: P0-2 修复 - 添加 flock 并发锁 + 原子写入防止竞态条件
# v11.15.0: P0-3 修复 - 会话隔离，检查 .dev-mode 中的分支是否与当前分支匹配
# v11.16.0: P0-4 修复 - session_id 验证 + 共享锁工具库 + 统一 CI 查询
# v11.18.0: H7-008 - TTY 会话隔离，有头模式下按 terminal 隔离
# v11.25.0: H7-009 - JSON API 实现（{"decision": "block", "reason": "..."}），15 次重试上限
# ============================================================================

set -euo pipefail

# ===== 无头模式：直接退出，让外部循环控制 =====
if [[ "${CECELIA_HEADLESS:-false}" == "true" ]]; then
    exit 0
fi

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
        exit 0
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
        exit 0
    fi
fi

# ===== 读取 Hook 输入（JSON） =====
HOOK_INPUT=$(cat)

# ===== 15 次重试计数器（替代旧的 stop_hook_active 检查）=====
# 此处不再检查 stop_hook_active，改为在 .dev-mode 中维护 retry_count
# 具体检查逻辑在后面的完成条件中处理

# ===== 获取项目根目录 =====
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ===== 检查 .dev-mode 文件 =====
DEV_MODE_FILE="$PROJECT_ROOT/.dev-mode"

if [[ ! -f "$DEV_MODE_FILE" ]]; then
    # 普通会话，没有 .dev-mode，直接允许结束
    exit 0
fi

# ===== 检查 cleanup 是否已完成 =====
# 优先检查 cleanup_done: true（向后兼容旧版本）
if grep -q "cleanup_done: true" "$DEV_MODE_FILE" 2>/dev/null; then
    rm -f "$DEV_MODE_FILE"
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

    # 删除 .dev-mode 文件
    rm -f "$DEV_MODE_FILE"

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

# 如果不是 dev 模式，直接退出
if [[ "$DEV_MODE" != "dev" ]]; then
    exit 0
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
    rm -f "$DEV_MODE_FILE"
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
    jq -n --arg reason "PR 未创建，继续执行 Step 8 创建 PR" '{"decision": "block", "reason": $reason}'
    exit 0
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
            jq -n --arg reason "CI 失败（$CI_CONCLUSION），查看日志修复问题后重新 push" --arg run_id "${CI_RUN_ID:-unknown}" '{"decision": "block", "reason": $reason, "ci_run_id": $run_id}'
            exit 0
        fi
        ;;
    "in_progress"|"queued"|"waiting"|"pending")
        echo "  ⏳ 条件 2: CI 进行中 ($CI_STATUS)" >&2
        echo "" >&2
        echo "  下一步: 等待 CI 完成" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        jq -n --arg reason "CI 进行中（$CI_STATUS），等待 CI 完成" '{"decision": "block", "reason": $reason}'
        exit 0
        ;;
    *)
        echo "  ⚠️  条件 2: CI 状态未知 ($CI_STATUS)" >&2
        echo "" >&2
        echo "  下一步: 检查 CI 状态" >&2
        echo "    gh run list --branch $BRANCH_NAME --limit 1" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        jq -n --arg reason "CI 状态未知（$CI_STATUS），检查 CI 状态" '{"decision": "block", "reason": $reason}'
        exit 0
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
        rm -f "$DEV_MODE_FILE"
        jq -n '{"decision": "allow", "reason": "PR 已合并且 Step 11 完成，工作流结束"}'
        exit 0  # 允许结束
    else
        echo "  ⚠️  Step 11 Cleanup 未完成" >&2
        echo "" >&2
        echo "  下一步: 执行 Step 11 Cleanup" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        jq -n '{"decision": "block", "reason": "PR 已合并，执行 Step 11 Cleanup"}'
        exit 0
    fi
else
    # PR 未合并
    echo "  ❌ 条件 3: PR 未合并" >&2
    echo "" >&2
    echo "  下一步: 合并 PR" >&2
    echo "    gh pr merge $PR_NUMBER --squash --delete-branch" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    jq -n --arg reason "PR #$PR_NUMBER CI 已通过但未合并，执行合并操作" --arg pr "$PR_NUMBER" '{"decision": "block", "reason": $reason, "pr_number": $pr}'
    exit 0
fi
