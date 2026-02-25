#!/usr/bin/env bash
# ZenithJoy Engine - PR 合并等待脚本
# 持续轮询 PR 状态，直到合并或发现需要修复的问题
#
# 用法: bash skills/dev/scripts/wait-for-merge.sh <PR_URL>
# 例如: bash skills/dev/scripts/wait-for-merge.sh https://github.com/user/repo/pull/123
#
# 退出码:
#   0 = PR 已合并
#   1 = 需要修复（CI 失败）
#   2 = 超时

set -euo pipefail

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 参数
PR_URL="${1:-}"

if [[ -z "$PR_URL" ]]; then
    echo -e "${RED}错误: 请提供 PR URL${NC}"
    echo "用法: bash wait-for-merge.sh <PR_URL>"
    exit 2
fi

# 从 URL 提取 PR 号和仓库（兼容末尾斜杠和查询参数）
# 清理 URL：移除末尾斜杠和查询参数（只处理 URL 末尾）
CLEAN_URL=$(echo "$PR_URL" | sed -E 's|/+$||; s|\?.*$||')
PR_NUMBER=$(echo "$CLEAN_URL" | grep -oE '/pull/[0-9]+' | grep -oE '[0-9]+' || echo "")
REPO=$(echo "$CLEAN_URL" | sed -E 's|https://github.com/([^/]+/[^/]+)/.*|\1|' || echo "")

if [[ -z "$PR_NUMBER" ]] || [[ -z "$REPO" ]] || [[ "$REPO" == "$CLEAN_URL" ]]; then
    echo -e "${RED}错误: 无法解析 PR URL${NC}"
    echo -e "${RED}期望格式: https://github.com/owner/repo/pull/123${NC}"
    exit 2
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ⏳ 等待 PR 合并"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PR: #$PR_NUMBER"
echo "  仓库: $REPO"
echo ""

# 配置
MAX_WAIT=600  # 10 分钟
INTERVAL=30   # 30 秒轮询一次
WAITED=0

while [ $WAITED -lt $MAX_WAIT ]; do
    # ========================================
    # 1. 检查 PR 状态
    # ========================================
    STATE=$(gh pr view "$PR_URL" --json state -q '.state' 2>/dev/null || echo "UNKNOWN")

    if [ "$STATE" = "MERGED" ]; then
        echo ""
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}  ✅ PR 已合并！(${WAITED}s)${NC}"
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        exit 0
    fi

    if [ "$STATE" = "CLOSED" ]; then
        echo ""
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${RED}  ❌ PR 被关闭（未合并）${NC}"
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        exit 1
    fi

    # ========================================
    # 2. 检查 CI 状态
    # ========================================
    # 使用 gh run list 检查最新的 CI 状态（避免 check-runs API 权限问题）
    # 通过 PR 的 head branch 获取最新的 workflow run
    HEAD_BRANCH=$(gh pr view "$PR_URL" --json headRefName -q '.headRefName' 2>/dev/null || echo "")
    if [ -n "$HEAD_BRANCH" ]; then
        # 获取该分支最新的 workflow run 状态
        CI_INFO=$(gh run list --repo "$REPO" --branch "$HEAD_BRANCH" --limit 1 --json status,conclusion 2>/dev/null || echo "")
        if [ -n "$CI_INFO" ] && [ "$CI_INFO" != "[]" ]; then
            CI_STATUS=$(echo "$CI_INFO" | jq -r '.[0].status // "unknown"' 2>/dev/null || echo "unknown")
            # jq -r 输出 null 时会得到字符串 "null"，需要额外处理
            CI_CONCLUSION_RAW=$(echo "$CI_INFO" | jq -r '.[0].conclusion' 2>/dev/null || echo "pending")
            # 处理 null 值：jq -r 会将 JSON null 输出为字符串 "null"
            if [ "$CI_CONCLUSION_RAW" = "null" ] || [ -z "$CI_CONCLUSION_RAW" ]; then
                CI_CONCLUSION="pending"
            else
                CI_CONCLUSION="$CI_CONCLUSION_RAW"
            fi
            # 如果 status 是 in_progress/queued，conclusion 会是 null
            if [ "$CI_STATUS" = "in_progress" ] || [ "$CI_STATUS" = "queued" ]; then
                CI_CONCLUSION="pending"
            fi
        else
            CI_CONCLUSION="unknown"
        fi
    else
        CI_CONCLUSION="unknown"
    fi

    if [ "$CI_CONCLUSION" = "failure" ]; then
        echo ""
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${RED}  ❌ CI 失败，需要修复${NC}"
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        echo "CI 错误日志:"
        gh run list --repo "$REPO" --limit 1 --json databaseId,conclusion -q '.[0].databaseId' | xargs -I {} gh run view {} --repo "$REPO" --log-failed 2>/dev/null | tail -50 || echo "(无法获取日志)"
        echo ""
        echo -e "${YELLOW}  请修复代码后重新 push${NC}"
        echo ""
        exit 1
    fi

    # ========================================
    # 3. 显示状态
    # ========================================
    CI_DISPLAY="${CI_CONCLUSION:-pending}"
    echo -e "${BLUE}⏳ 等待中... STATE=$STATE CI=$CI_DISPLAY (${WAITED}s)${NC}"

    # ========================================
    # 4. 等待
    # ========================================
    sleep $INTERVAL
    WAITED=$((WAITED + INTERVAL))
done

# ========================================
# 超时
# ========================================
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  ⏰ 等待超时（${MAX_WAIT}s）${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "PR 状态: $STATE"
echo "请手动检查: $PR_URL"
echo ""
exit 2
