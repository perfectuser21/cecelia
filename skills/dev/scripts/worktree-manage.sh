#!/usr/bin/env bash
# ZenithJoy Engine - Worktree 管理脚本
# v1.1.0: rm -rf 安全验证
# v1.0.0: 初始版本 - 创建、列表、清理 worktree
#
# 用法:
#   worktree-manage.sh create <task-name>   # 创建新 worktree
#   worktree-manage.sh list                 # 列出所有 worktree
#   worktree-manage.sh remove <branch>      # 移除指定 worktree
#   worktree-manage.sh cleanup              # 清理已合并的 worktree

set -euo pipefail

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 安全删除目录 - 验证路径有效性
# 用法: safe_rm_rf <path> <allowed_parent>
safe_rm_rf() {
    local path="$1"
    local allowed_parent="$2"

    # 验证 1: 路径非空
    if [[ -z "$path" ]]; then
        echo -e "${RED}错误: rm -rf 路径为空，拒绝执行${NC}" >&2
        return 1
    fi

    # 验证 2: 路径存在
    if [[ ! -e "$path" ]]; then
        echo -e "${YELLOW}警告: 路径不存在: $path${NC}" >&2
        return 0
    fi

    # 验证 3: 路径在允许的父目录内
    local real_path
    real_path=$(realpath "$path" 2>/dev/null) || real_path="$path"
    local real_parent
    real_parent=$(realpath "$allowed_parent" 2>/dev/null) || real_parent="$allowed_parent"

    if [[ "$real_path" != "$real_parent"* ]]; then
        echo -e "${RED}错误: 路径 $path 不在允许范围 $allowed_parent 内，拒绝删除${NC}" >&2
        return 1
    fi

    # 验证 4: 禁止删除根目录或 home 目录
    if [[ "$real_path" == "/" || "$real_path" == "$HOME" || "$real_path" == "/home" ]]; then
        echo -e "${RED}错误: 禁止删除系统关键目录: $real_path${NC}" >&2
        return 1
    fi

    # 安全删除
    rm -rf "$path"
}

# 获取项目根目录（主工作区）
get_main_worktree() {
    git worktree list 2>/dev/null | head -1 | awk '{print $1}'
}

# 获取项目名称
get_project_name() {
    local main_wt
    main_wt=$(get_main_worktree)
    basename "$main_wt"
}

# 检查是否在 worktree 中
is_in_worktree() {
    local git_dir
    git_dir=$(git rev-parse --git-dir 2>/dev/null)
    [[ "$git_dir" == *"worktrees"* ]]
}

# 生成 worktree 路径
generate_worktree_path() {
    local task_name="$1"
    local main_wt
    main_wt=$(get_main_worktree)
    local base_path="${main_wt}-wt-${task_name}"
    local final_path="$base_path"
    local counter=2

    # 如果路径已存在，追加序号
    while [[ -d "$final_path" ]]; do
        final_path="${base_path}-${counter}"
        ((counter++))
    done

    echo "$final_path"
}

# 创建 worktree
cmd_create() {
    local task_name="${1:-}"

    if [[ -z "$task_name" ]]; then
        echo -e "${RED}错误: 请提供任务名${NC}" >&2
        echo "用法: worktree-manage.sh create <task-name>" >&2
        exit 1
    fi

    # 生成分支名和 worktree 路径
    local timestamp
    timestamp=$(date +%m%d%H%M)
    local branch_name="cp-${timestamp}-${task_name}"
    local worktree_path
    worktree_path=$(generate_worktree_path "$task_name")

    # 获取当前分支作为 base
    local base_branch
    base_branch=$(git rev-parse --abbrev-ref HEAD)

    # 如果在 cp-* 或 feature/* 分支，使用其 base 分支
    if [[ "$base_branch" =~ ^(cp-|feature/) ]]; then
        local saved_base
        saved_base=$(git config "branch.$base_branch.base-branch" 2>/dev/null || echo "")
        if [[ -n "$saved_base" ]]; then
            base_branch="$saved_base"
        else
            base_branch="develop"
        fi
    fi

    echo -e "${BLUE}创建 Worktree...${NC}" >&2
    echo "  分支: $branch_name" >&2
    echo "  路径: $worktree_path" >&2
    echo "  Base: $base_branch" >&2
    echo "" >&2

    # 创建 worktree（同时创建新分支）
    if git worktree add -b "$branch_name" "$worktree_path" "$base_branch" 2>&2; then
        # 保存 base 分支到 git config
        git config "branch.$branch_name.base-branch" "$base_branch"

        echo -e "${GREEN}✅ Worktree 创建成功${NC}" >&2
        echo "" >&2
        echo "下一步:" >&2
        echo "  cd $worktree_path" >&2
        echo "  claude  # 或继续开发" >&2

        # 输出路径供脚本使用
        echo "$worktree_path"
    else
        echo -e "${RED}❌ Worktree 创建失败${NC}" >&2
        exit 1
    fi
}

# 列出所有 worktree
cmd_list() {
    echo -e "${BLUE}Worktree 列表:${NC}"
    echo ""

    local main_wt
    main_wt=$(get_main_worktree)

    git worktree list 2>/dev/null | while read -r line; do
        local path branch
        path=$(echo "$line" | awk '{print $1}')
        branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')

        if [[ "$path" == "$main_wt" ]]; then
            echo -e "  ${GREEN}[主]${NC} $path ($branch)"
        else
            # 检查是否有 PR
            local pr_num
            pr_num=$(gh pr list --head "$branch" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
            if [[ -n "$pr_num" ]]; then
                echo -e "  ${YELLOW}[wt]${NC} $path ($branch, PR #$pr_num)"
            else
                echo -e "  ${YELLOW}[wt]${NC} $path ($branch)"
            fi
        fi
    done
    echo ""
}

# 移除指定 worktree
cmd_remove() {
    local branch="${1:-}"

    if [[ -z "$branch" ]]; then
        echo -e "${RED}错误: 请提供分支名${NC}" >&2
        echo "用法: worktree-manage.sh remove <branch>" >&2
        exit 1
    fi

    # 查找 worktree 路径
    local worktree_path
    worktree_path=$(git worktree list 2>/dev/null | grep "\[$branch\]" | awk '{print $1}')

    if [[ -z "$worktree_path" ]]; then
        echo -e "${YELLOW}未找到分支 $branch 的 worktree${NC}"
        return 0
    fi

    # 检查是否当前在该 worktree 中
    local current_path
    current_path=$(pwd)
    if [[ "$current_path" == "$worktree_path"* ]]; then
        echo -e "${RED}错误: 不能删除当前所在的 worktree${NC}" >&2
        echo "请先切换到主工作区: cd $(get_main_worktree)" >&2
        exit 1
    fi

    echo -e "${BLUE}移除 Worktree...${NC}"
    echo "  路径: $worktree_path"
    echo "  分支: $branch"
    echo ""

    # 检查是否有未提交的改动
    if [[ -d "$worktree_path" ]]; then
        local uncommitted
        uncommitted=$(git -C "$worktree_path" status --porcelain 2>/dev/null | grep -v "node_modules" || true)
        if [[ -n "$uncommitted" ]]; then
            echo -e "${YELLOW}⚠️  警告: worktree 有未提交的改动:${NC}"
            echo "$uncommitted" | head -5 | sed 's/^/   /'
            echo ""
            read -p "确定要删除? (y/N) " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo "已取消"
                exit 0
            fi
        fi
    fi

    # 移除 worktree
    if git worktree remove "$worktree_path" --force 2>/dev/null; then
        echo -e "${GREEN}✅ Worktree 已移除${NC}"
    else
        echo -e "${RED}❌ Worktree 移除失败，尝试强制移除...${NC}"
        # v1.1.0: 使用安全删除，限制在主 worktree 的父目录内
        local main_wt_parent
        main_wt_parent=$(dirname "$(get_main_worktree)")
        if safe_rm_rf "$worktree_path" "$main_wt_parent"; then
            git worktree prune
            echo -e "${GREEN}✅ 已强制移除${NC}"
        else
            echo -e "${RED}❌ 安全检查失败，请手动删除: $worktree_path${NC}"
        fi
    fi
}

# 清理已合并的 worktree
cmd_cleanup() {
    echo -e "${BLUE}清理已合并的 Worktree...${NC}"
    echo ""

    local main_wt
    main_wt=$(get_main_worktree)
    local cleaned=0

    git worktree list 2>/dev/null | while read -r line; do
        local path branch
        path=$(echo "$line" | awk '{print $1}')
        branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')

        # 跳过主工作区
        [[ "$path" == "$main_wt" ]] && continue

        # 检查分支是否已合并
        if git branch --merged develop 2>/dev/null | grep -q "$branch"; then
            echo "  移除已合并的 worktree: $path ($branch)"
            git worktree remove "$path" --force 2>/dev/null || true
            ((cleaned++))
        fi
    done

    # 清理 stale worktree
    git worktree prune

    if [[ $cleaned -eq 0 ]]; then
        echo -e "${GREEN}✅ 无需清理${NC}"
    else
        echo ""
        echo -e "${GREEN}✅ 已清理 $cleaned 个 worktree${NC}"
    fi
}

# 主入口
main() {
    local cmd="${1:-}"
    shift || true

    case "$cmd" in
        create)
            cmd_create "$@"
            ;;
        list)
            cmd_list
            ;;
        remove)
            cmd_remove "$@"
            ;;
        cleanup)
            cmd_cleanup
            ;;
        *)
            echo "ZenithJoy Engine - Worktree 管理"
            echo ""
            echo "用法:"
            echo "  worktree-manage.sh create <task-name>   创建新 worktree"
            echo "  worktree-manage.sh list                 列出所有 worktree"
            echo "  worktree-manage.sh remove <branch>      移除指定 worktree"
            echo "  worktree-manage.sh cleanup              清理已合并的 worktree"
            exit 1
            ;;
    esac
}

main "$@"
