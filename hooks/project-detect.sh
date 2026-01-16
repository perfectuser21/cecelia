#!/usr/bin/env bash
# project-detect.sh - 检测当前目录是否是已初始化的项目
# 这是信息性 hook，只提示不阻止

set -euo pipefail

# 读取 stdin（Claude Code hooks 需要）
cat > /dev/null

# 颜色定义
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 获取当前目录
PROJECT_ROOT=$(pwd)

# 检测标志
MISSING_ITEMS=()

# 1. 检测 git 仓库
if ! git rev-parse --git-dir &>/dev/null; then
    MISSING_ITEMS+=("⚠️  缺少 .git 目录 - 项目未初始化为 git 仓库")
fi

# 2. 检测 remote
if git rev-parse --git-dir &>/dev/null; then
    if [[ -z $(git remote 2>/dev/null) ]]; then
        MISSING_ITEMS+=("⚠️  缺少 git remote - 没有配置远程仓库")
    fi
fi

# 3. 检测 .github/workflows/ci.yml（使用绝对路径）
if [[ ! -f "$PROJECT_ROOT/.github/workflows/ci.yml" ]]; then
    MISSING_ITEMS+=("⚠️  缺少 .github/workflows/ci.yml - 没有配置 CI/CD")
fi

# 4. 检测 CLAUDE.md（使用绝对路径）
if [[ ! -f "$PROJECT_ROOT/CLAUDE.md" ]]; then
    MISSING_ITEMS+=("⚠️  缺少 CLAUDE.md - 没有项目说明文档")
fi

# 如果有缺失项，输出提示信息
if [[ ${#MISSING_ITEMS[@]} -gt 0 ]]; then
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
    echo -e "${YELLOW}  项目初始化检测${NC}" >&2
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
    echo "" >&2
    echo -e "${BLUE}当前目录:${NC} ${PROJECT_ROOT}" >&2
    echo "" >&2

    for item in "${MISSING_ITEMS[@]}"; do
        echo -e "  ${item}" >&2
    done

    echo "" >&2
    echo -e "${BLUE}建议操作:${NC}" >&2
    echo -e "  运行 ${YELLOW}/dev${NC} 开始开发流程" >&2
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
    echo "" >&2
fi

# 信息性 hook，不阻止任何操作
exit 0
