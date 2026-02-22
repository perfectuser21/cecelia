#!/usr/bin/env bash
#
# setup-branch-protection.sh - 统一配置 GitHub 分支保护
#
# 用法:
#   ./setup-branch-protection.sh --check              # 检查所有仓库
#   ./setup-branch-protection.sh --fix                # 修复所有仓库
#   ./setup-branch-protection.sh --check owner/repo   # 检查指定仓库
#   ./setup-branch-protection.sh --fix owner/repo     # 修复指定仓库

set -euo pipefail

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# 默认保护的仓库列表
DEFAULT_REPOS=(
    "perfectuser21/zenithjoy-engine"
    "perfectuser21/zenithjoy-autopilot"
    "perfectuser21/zenithjoy-core"
)

# 需要保护的分支
BRANCHES=("main" "develop")

# 标准保护配置
STANDARD_CONFIG='{
    "required_status_checks": {
        "strict": true,
        "checks": [{"context": "ci-passed"}]
    },
    "enforce_admins": true,
    "required_pull_request_reviews": null,
    "restrictions": null,
    "allow_force_pushes": false,
    "allow_deletions": false
}'

usage() {
    echo "用法: $0 [--check|--fix] [owner/repo]"
    echo ""
    echo "选项:"
    echo "  --check    检查保护状态（默认）"
    echo "  --fix      修复保护配置"
    echo ""
    echo "示例:"
    echo "  $0 --check                    # 检查所有默认仓库"
    echo "  $0 --fix                      # 修复所有默认仓库"
    echo "  $0 --check owner/repo         # 检查指定仓库"
    echo "  $0 --fix owner/repo           # 修复指定仓库"
    exit 1
}

# 检查单个分支的保护状态
check_branch() {
    local repo=$1
    local branch=$2

    local result
    result=$(gh api "repos/$repo/branches/$branch/protection" 2>&1) || {
        echo -e "  ${RED}✗${NC} $branch: 无保护"
        return 1
    }

    # Bug fix: 验证 API 返回的是有效 JSON（避免错误消息被当作 JSON 解析）
    if ! echo "$result" | jq empty 2>/dev/null; then
        echo -e "  ${RED}✗${NC} $branch: API 返回错误: $result"
        return 1
    fi

    # Bug fix: 统一使用相同的 jq 逻辑处理所有字段
    local enforce_admins
    enforce_admins=$(echo "$result" | jq -r 'if .enforce_admins.enabled == true then "true" else "false" end')

    local allow_force_pushes
    allow_force_pushes=$(echo "$result" | jq -r 'if .allow_force_pushes.enabled == true then "true" else "false" end')

    local allow_deletions
    allow_deletions=$(echo "$result" | jq -r 'if .allow_deletions.enabled == true then "true" else "false" end')

    local issues=()

    if [[ "$enforce_admins" != "true" ]]; then
        issues+=("enforce_admins=false")
    fi

    if [[ "$allow_force_pushes" == "true" ]]; then
        issues+=("allow_force_pushes=true")
    fi

    if [[ "$allow_deletions" == "true" ]]; then
        issues+=("allow_deletions=true")
    fi

    if [[ ${#issues[@]} -eq 0 ]]; then
        echo -e "  ${GREEN}✓${NC} $branch: 保护正确"
        return 0
    else
        echo -e "  ${YELLOW}⚠${NC} $branch: ${issues[*]}"
        return 1
    fi
}

# 修复单个分支的保护配置
fix_branch() {
    local repo=$1
    local branch=$2

    echo -e "  修复 $branch..."

    # 检查分支是否存在
    if ! gh api "repos/$repo/branches/$branch" >/dev/null 2>&1; then
        echo -e "  ${YELLOW}⚠${NC} $branch: 分支不存在，跳过"
        return 0
    fi

    # 检查是否已有保护
    local has_protection=false
    if gh api "repos/$repo/branches/$branch/protection" >/dev/null 2>&1; then
        has_protection=true
    fi

    if [[ "$has_protection" == "true" ]]; then
        # 已有保护，只更新 enforce_admins
        if gh api -X POST "repos/$repo/branches/$branch/protection/enforce_admins" >/dev/null 2>&1; then
            echo -e "  ${GREEN}✓${NC} $branch: enforce_admins 已启用"
        else
            echo -e "  ${RED}✗${NC} $branch: enforce_admins 设置失败"
            return 1
        fi
    else
        # 无保护，创建完整保护
        gh api -X PUT "repos/$repo/branches/$branch/protection" \
            --input - <<< "$STANDARD_CONFIG" >/dev/null 2>&1 || {
            echo -e "  ${RED}✗${NC} $branch: 创建保护失败"
            return 1
        }
        # 再启用 enforce_admins
        if gh api -X POST "repos/$repo/branches/$branch/protection/enforce_admins" >/dev/null 2>&1; then
            echo -e "  ${GREEN}✓${NC} $branch: 完整保护已创建"
        else
            echo -e "  ${RED}✗${NC} $branch: enforce_admins 设置失败"
            return 1
        fi
    fi

    return 0
}

# 处理单个仓库
process_repo() {
    local repo=$1
    local mode=$2

    echo ""
    echo "=== $repo ==="

    # 检查仓库是否存在
    if ! gh repo view "$repo" >/dev/null 2>&1; then
        echo -e "  ${RED}✗${NC} 仓库不存在或无权限"
        return 1
    fi

    local has_issues=false

    for branch in "${BRANCHES[@]}"; do
        if [[ "$mode" == "check" ]]; then
            check_branch "$repo" "$branch" || has_issues=true
        else
            fix_branch "$repo" "$branch" || has_issues=true
        fi
    done

    if [[ "$has_issues" == "true" ]]; then
        return 1
    fi
    return 0
}

main() {
    local mode="check"
    local repos=()

    # 解析参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            --check)
                mode="check"
                shift
                ;;
            --fix)
                mode="fix"
                shift
                ;;
            --help|-h)
                usage
                ;;
            *)
                if [[ "$1" == */* ]]; then
                    repos+=("$1")
                else
                    echo "错误: 无效的仓库格式 '$1'，应为 owner/repo"
                    exit 1
                fi
                shift
                ;;
        esac
    done

    # 如果没有指定仓库，使用默认列表
    if [[ ${#repos[@]} -eq 0 ]]; then
        repos=("${DEFAULT_REPOS[@]}")
    fi

    echo "GitHub 分支保护检查工具"
    echo "模式: $mode"
    echo "仓库: ${repos[*]}"

    local all_ok=true

    for repo in "${repos[@]}"; do
        process_repo "$repo" "$mode" || all_ok=false
    done

    echo ""
    if [[ "$all_ok" == "true" ]]; then
        echo -e "${GREEN}✓ 所有仓库保护正确${NC}"
        exit 0
    else
        if [[ "$mode" == "check" ]]; then
            echo -e "${YELLOW}⚠ 发现问题，运行 --fix 修复${NC}"
        else
            echo -e "${YELLOW}⚠ 部分修复失败${NC}"
        fi
        exit 1
    fi
}

main "$@"
