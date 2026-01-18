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

# 从 URL 提取 PR 号和仓库
PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')
REPO=$(echo "$PR_URL" | sed -E 's|https://github.com/([^/]+/[^/]+)/.*|\1|')

if [[ -z "$PR_NUMBER" ]] || [[ -z "$REPO" ]]; then
    echo -e "${RED}错误: 无法解析 PR URL${NC}"
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
    # 尝试获取 CI 状态（可能因权限失败）
    HEAD_REF=$(gh pr view "$PR_URL" --json headRefOid -q '.headRefOid' 2>/dev/null || echo "")
    if [ -n "$HEAD_REF" ]; then
        CI_CONCLUSION=$(gh api "repos/$REPO/commits/$HEAD_REF/check-runs" \
            --jq '.check_runs | map(select(.conclusion != null)) | .[0].conclusion // "pending"' 2>/dev/null || echo "unknown")
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

        # 回退到 step 3（DoD 完成），允许从 Step 4 重新开始
        # 只有 step >= 3 时才回退，否则说明 DoD 还没完成
        CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
        if [[ "$CURRENT_BRANCH" =~ ^cp-[a-zA-Z0-9] ]]; then
            CURRENT_STEP=$(git config --get branch."$CURRENT_BRANCH".step 2>/dev/null || echo "0")
            if [[ "$CURRENT_STEP" -ge 3 ]]; then
                git config branch."$CURRENT_BRANCH".step 3
                echo -e "${YELLOW}  ⟲ step 回退到 3，从 Step 4 重新循环 4→5→6${NC}"
                echo ""
                echo -e "${YELLOW}  请继续：${NC}"
                echo -e "${YELLOW}    Step 4: 修复代码${NC}"
                echo -e "${YELLOW}    Step 5: 更新测试${NC}"
                echo -e "${YELLOW}    Step 6: 跑测试通过${NC}"
                echo -e "${YELLOW}    然后 push 触发 CI${NC}"
                echo ""
                echo -e "${YELLOW}  注意：DoD 不变，只改代码。${NC}"
            else
                echo -e "${YELLOW}  请先运行 /dev 完成 PRD 和 DoD（Step 1-3）${NC}"
            fi
        fi

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
