#!/usr/bin/env bash
# ZenithJoy Engine - Worktree 管理脚本
# v1.2.0: 路径迁移到 .claude/worktrees/（对齐官方 Claude Code 约定）
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

# 生成 worktree 路径（v1.2.0: 对齐官方 .claude/worktrees/ 约定）
generate_worktree_path() {
    local task_name="$1"
    local main_wt
    main_wt=$(get_main_worktree)
    local base_path="${main_wt}/.claude/worktrees/${task_name}"
    local final_path="$base_path"
    local counter=2

    # 如果路径已存在，追加序号
    while [[ -d "$final_path" ]]; do
        final_path="${base_path}-${counter}"
        ((counter++))
    done

    echo "$final_path"
}

# 创建 worktree（带 flock 防并发竞争）
cmd_create() {
    local task_name="${1:-}"

    if [[ -z "$task_name" ]]; then
        echo -e "${RED}错误: 请提供任务名${NC}" >&2
        echo "用法: worktree-manage.sh create <task-name>" >&2
        exit 1
    fi

    # flock 防止多个 Cecelia 并发创建 worktree 竞争
    local lock_dir
    lock_dir="$(git rev-parse --git-dir 2>/dev/null || echo '/tmp')"
    local lock_file="$lock_dir/worktree-create.lock"
    exec 201>"$lock_file"
    if ! flock -w 5 201; then
        echo -e "${RED}错误: 另一个进程正在创建 worktree，请稍后重试${NC}" >&2
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
            # 动态检测：有 develop 用 develop，否则用 main
            if git rev-parse --verify develop &>/dev/null 2>&1; then
                base_branch="develop"
            else
                base_branch="main"
            fi
        fi
    fi

    # 🆕 Bug 2 修复：创建前先更新 base 分支
    echo -e "${BLUE}更新 $base_branch 分支...${NC}" >&2

    # 获取主仓库路径
    local main_wt
    main_wt=$(get_main_worktree)

    # 在主仓库中更新 develop
    if git -C "$main_wt" rev-parse --verify "$base_branch" &>/dev/null; then
        # 检查当前分支
        local current_branch
        current_branch=$(git -C "$main_wt" rev-parse --abbrev-ref HEAD)

        if [[ "$current_branch" == "$base_branch" ]]; then
            # 如果当前在 base 分支上，用 pull
            if git -C "$main_wt" pull origin "$base_branch" --ff-only 2>&2; then
                echo -e "${GREEN}✅ $base_branch 已更新${NC}" >&2
            else
                echo -e "${YELLOW}⚠️  无法更新 $base_branch，使用当前版本${NC}" >&2
            fi
        else
            # 不在 base 分支上，用 fetch + branch -f
            if git -C "$main_wt" fetch origin "$base_branch" 2>&2; then
                if git -C "$main_wt" branch -f "$base_branch" "origin/$base_branch" 2>&2; then
                    echo -e "${GREEN}✅ $base_branch 已更新${NC}" >&2
                else
                    echo -e "${YELLOW}⚠️  无法更新 $base_branch，使用当前版本${NC}" >&2
                fi
            else
                echo -e "${YELLOW}⚠️  无法 fetch，使用当前版本${NC}" >&2
            fi
        fi
    fi
    echo "" >&2

    # v1.2.0: 确保 .claude/worktrees/ 目录存在
    mkdir -p "$(dirname "$worktree_path")"

    # v1.2.0: 自动确保 .claude/worktrees/ 在 .gitignore 中
    local gitignore_file="$main_wt/.gitignore"
    if [[ -f "$gitignore_file" ]]; then
        if ! grep -q '\.claude/worktrees/' "$gitignore_file" 2>/dev/null; then
            echo "" >> "$gitignore_file"
            echo "# Claude Code worktrees" >> "$gitignore_file"
            echo ".claude/worktrees/" >> "$gitignore_file"
            echo -e "${GREEN}✅ 已添加 .claude/worktrees/ 到 .gitignore${NC}" >&2
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
        # v1.2.0: 支持新路径（.claude/worktrees/）和旧路径（仓库外）
        local allowed_parent
        if [[ "$worktree_path" == *"/.claude/worktrees/"* ]]; then
            allowed_parent="$(get_main_worktree)/.claude/worktrees"
        else
            allowed_parent=$(dirname "$(get_main_worktree)")
        fi
        if safe_rm_rf "$worktree_path" "$allowed_parent"; then
            git worktree prune
            echo -e "${GREEN}✅ 已强制移除${NC}"
        else
            echo -e "${RED}❌ 安全检查失败，请手动删除: $worktree_path${NC}"
        fi
    fi
}

# 清理已合并的 worktree
# v1.3.0: 委托给 worktree-gc.sh（用 gh pr list 检测，不用 git branch --merged）
cmd_cleanup() {
    echo -e "${BLUE}清理已合并的 Worktree...${NC}"
    echo ""

    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local gc_script="$script_dir/worktree-gc.sh"

    if [[ -f "$gc_script" ]]; then
        bash "$gc_script" "$@"
    else
        echo -e "${RED}错误: worktree-gc.sh 不存在${NC}" >&2
        exit 1
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
