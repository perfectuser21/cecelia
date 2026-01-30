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
# ============================================================================

set -euo pipefail

# ===== 无头模式：直接退出，让外部循环控制 =====
if [[ "${CECELIA_HEADLESS:-false}" == "true" ]]; then
    exit 0
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
BRANCH_NAME=$(grep "^branch:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2 || echo "")

# 如果不是 dev 模式，直接退出
if [[ "$DEV_MODE" != "dev" ]]; then
    exit 0
fi

# ===== 获取当前分支（fallback） =====
if [[ -z "$BRANCH_NAME" ]]; then
    BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
fi

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

# 获取最新的 workflow run
RUN_INFO=$(gh run list --branch "$BRANCH_NAME" --limit 1 --json status,conclusion,databaseId 2>/dev/null || echo "[]")

if [[ "$RUN_INFO" != "[]" && -n "$RUN_INFO" ]]; then
    CI_STATUS=$(echo "$RUN_INFO" | jq -r '.[0].status // "unknown"')
    CI_CONCLUSION=$(echo "$RUN_INFO" | jq -r '.[0].conclusion // ""')
fi

case "$CI_STATUS" in
    "completed")
        if [[ "$CI_CONCLUSION" == "success" ]]; then
            echo "  ✅ 条件 2: CI 通过" >&2
        else
            echo "  ❌ 条件 2: CI 失败 ($CI_CONCLUSION)" >&2
            echo "" >&2
            echo "  下一步: 查看 CI 日志并修复" >&2
            RUN_ID=$(echo "$RUN_INFO" | jq -r '.[0].databaseId // ""')
            if [[ -n "$RUN_ID" ]]; then
                echo "    gh run view $RUN_ID --log-failed" >&2
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
