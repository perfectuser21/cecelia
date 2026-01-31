#!/usr/bin/env bash
# ============================================================================
# Stop Hook: 循环控制器（替代 Ralph Loop）
# ============================================================================
# 检测 .dev-mode 文件，根据完成条件决定是否允许会话结束：
#
# 无 .dev-mode → exit 0（普通会话，允许结束）
# 有 .dev-mode → 检查完成条件：
#   - PR 创建？
#   - CI 通过？
#   - PR 合并？
#   全部满足 → 删除 .dev-mode → exit 0
#   未满足 → 输出提示 → exit 2（阻止结束，继续执行）
#
# v11.11.0: P0-2 修复 - 添加 flock 并发锁 + 原子写入防止竞态条件
# v11.15.0: P0-3 修复 - 会话隔离，检查 .dev-mode 中的分支是否与当前分支匹配
# v11.16.0: P0-4 修复 - session_id 验证 + 共享锁工具库 + 统一 CI 查询
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
        exit 2
    fi
fi

# ===== 读取 Hook 输入（JSON） =====
HOOK_INPUT=$(cat)

# ===== 防止无限循环 =====
STOP_HOOK_ACTIVE=$(echo "$HOOK_INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || echo "false")

if [[ "$STOP_HOOK_ACTIVE" == "true" ]]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [Stop Hook: 防止无限循环]" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "  已重试过一次，允许会话结束" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 0
fi

# ===== 获取项目根目录 =====
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ===== 检查 .dev-mode 文件 =====
DEV_MODE_FILE="$PROJECT_ROOT/.dev-mode"

if [[ ! -f "$DEV_MODE_FILE" ]]; then
    # 普通会话，没有 .dev-mode，直接允许结束
    exit 0
fi

# ===== 检查 cleanup 是否已完成 =====
if grep -q "cleanup_done: true" "$DEV_MODE_FILE" 2>/dev/null; then
    rm -f "$DEV_MODE_FILE"
    exit 0
fi

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

# 如果 .dev-mode 中的分支与当前分支不匹配，忽略这个 .dev-mode
# 这防止多个 Claude 会话"串线"（一个会话被迫接手另一个会话的任务）
if [[ -n "$BRANCH_IN_FILE" && "$BRANCH_IN_FILE" != "$CURRENT_BRANCH" ]]; then
    # 不是当前会话的任务，直接允许结束
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
    exit 2
fi

echo "  ✅ 条件 1: PR 已创建 (#$PR_NUMBER)" >&2

# ===== 条件 2 & 3: 检查 PR 是否已合并 =====
if [[ "$PR_STATE" == "merged" ]]; then
    echo "  ✅ 条件 2: CI 通过（PR 已合并）" >&2
    echo "  ✅ 条件 3: PR 已合并" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  🧹 自动执行 Cleanup..." >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

    # P0-2 修复：PR 合并后自动执行 cleanup，不要只提示然后悬空
    # 删除 .dev-mode 文件（循环控制信号）
    if [[ -f "$DEV_MODE_FILE" ]]; then
        rm -f "$DEV_MODE_FILE"
        echo "  ✅ .dev-mode 已删除" >&2
    fi

    # 切换到 develop 分支
    BASE_BRANCH=$(git config --get branch."$BRANCH_NAME".base-branch 2>/dev/null || echo "develop")
    echo "  ✅ 切换到 $BASE_BRANCH 分支..." >&2
    git checkout "$BASE_BRANCH" 2>/dev/null || true
    git pull origin "$BASE_BRANCH" 2>/dev/null || true

    # 删除本地功能分支
    if git branch --list "$BRANCH_NAME" | grep -q "$BRANCH_NAME"; then
        git branch -D "$BRANCH_NAME" 2>/dev/null || true
        echo "  ✅ 本地分支 $BRANCH_NAME 已删除" >&2
    fi

    # 清理 git config
    git config --unset branch."$BRANCH_NAME".base-branch 2>/dev/null || true

    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  🎉 /dev 流程完成！" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

    exit 0  # 完成，允许会话结束
fi

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
            exit 2
        fi
        ;;
    "in_progress"|"queued"|"waiting"|"pending")
        echo "  ⏳ 条件 2: CI 进行中 ($CI_STATUS)" >&2
        echo "" >&2
        echo "  下一步: 等待 CI 完成" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        exit 2
        ;;
    *)
        echo "  ⚠️  条件 2: CI 状态未知 ($CI_STATUS)" >&2
        echo "" >&2
        echo "  下一步: 检查 CI 状态" >&2
        echo "    gh run list --branch $BRANCH_NAME --limit 1" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        exit 2
        ;;
esac

# ===== 条件 3: PR 已合并？（CI 通过后检查） =====
echo "  ❌ 条件 3: PR 未合并" >&2
echo "" >&2
echo "  下一步: 合并 PR" >&2
echo "    gh pr merge $PR_NUMBER --squash --delete-branch" >&2
echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
exit 2
