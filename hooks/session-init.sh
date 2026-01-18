#!/usr/bin/env bash
# ============================================================================
# session-init.sh - 会话初始化 Hook（Notification）
# ============================================================================
#
# 触发：会话开始时
# 作用：检测项目、加载上下文、提示缺什么
#
# ============================================================================

set -euo pipefail

# 获取项目根目录
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$PROJECT_ROOT"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📋 会话初始化"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ========================================
# 1. 项目信息
# ========================================
PROJECT_NAME=$(basename "$PROJECT_ROOT")
echo -e "${BLUE}项目${NC}: $PROJECT_NAME"

# 检测项目类型
if [[ -f "package.json" ]]; then
    VERSION=$(jq -r '.version // "unknown"' package.json 2>/dev/null || echo "unknown")
    echo -e "${BLUE}类型${NC}: Node.js (v$VERSION)"
elif [[ -f "pyproject.toml" ]]; then
    echo -e "${BLUE}类型${NC}: Python"
elif [[ -f "go.mod" ]]; then
    echo -e "${BLUE}类型${NC}: Go"
fi

# ========================================
# 2. 分支状态
# ========================================
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
echo -e "${BLUE}分支${NC}: $CURRENT_BRANCH"

# 如果在 cp-* 分支，显示进度
if [[ "$CURRENT_BRANCH" =~ ^cp-[a-zA-Z0-9] ]]; then
    CURRENT_STEP=$(git config --get branch."$CURRENT_BRANCH".step 2>/dev/null || echo "0")
    BASE_BRANCH=$(git config --get branch."$CURRENT_BRANCH".base-branch 2>/dev/null || echo "develop")

    echo ""
    echo -e "${YELLOW}⚡ 进行中的任务${NC}"
    echo "   Step: $CURRENT_STEP/10"
    echo "   Base: $BASE_BRANCH"

    # 提示下一步
    case $CURRENT_STEP in
        0|1) echo "   → 下一步: PRD 确认" ;;
        2) echo "   → 下一步: DoD 确认" ;;
        3) echo "   → 下一步: 写代码" ;;
        4) echo "   → 下一步: 写测试" ;;
        5) echo "   → 下一步: 跑测试" ;;
        6) echo "   → 下一步: 提交 PR" ;;
        7) echo "   → 下一步: 等 CI" ;;
        8) echo "   → 下一步: 合并" ;;
        9) echo "   → 下一步: Cleanup" ;;
    esac
fi

# ========================================
# 3. 测试能力
# ========================================
if [[ -f ".project-info.json" ]]; then
    MAX_LEVEL=$(jq -r '.test_levels.max_level // 0' .project-info.json 2>/dev/null || echo "0")
    echo ""
    echo -e "${BLUE}测试能力${NC}: L$MAX_LEVEL"
else
    echo ""
    echo -e "${YELLOW}⚠️ 项目未检测，运行任意命令触发检测${NC}"
fi

# ========================================
# 4. 缺什么提示
# ========================================
echo ""
MISSING=()

# 检查 gh CLI
if ! command -v gh &>/dev/null; then
    MISSING+=("gh CLI")
fi

# 检查 jq
if ! command -v jq &>/dev/null; then
    MISSING+=("jq")
fi

# 检查 gh 登录
if ! gh auth status &>/dev/null; then
    MISSING+=("gh 未登录")
fi

if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo -e "${YELLOW}缺少${NC}: ${MISSING[*]}"
else
    echo -e "${GREEN}✓ 环境就绪${NC}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
