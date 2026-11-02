#!/usr/bin/env bash
# 由worktree-manage.sh加载，复用同一Git目录、路径与删除安全校验。

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
        # v1.3.0: 支持新路径（~/worktrees/）、旧路径（.claude/worktrees/）和仓库外路径
        local allowed_parent
        local _wt_base="${WORKTREE_BASE:-$HOME/worktrees}"
        local _proj_name
        _proj_name=$(get_project_name)
        if [[ "$worktree_path" == "${_wt_base}/${_proj_name}/"* ]]; then
            allowed_parent="${_wt_base}/${_proj_name}"
        elif [[ "$worktree_path" == *"/.claude/worktrees/"* ]]; then
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
# v1.4.0: 内联实现 — 用 gh pr list 检测已合并 PR，不依赖外部 worktree-gc.sh
cmd_cleanup() {
    echo -e "${BLUE}清理已合并的 Worktree...${NC}"
    echo ""

    local main_wt
    main_wt=$(get_main_worktree)
    local worktree_base="${WORKTREE_BASE:-$HOME/worktrees}"
    local cleaned=0
    local skipped=0

    while IFS= read -r wt_line; do
        local wt_path wt_branch
        wt_path=$(echo "$wt_line" | awk '{print $1}')
        wt_branch=$(echo "$wt_line" | awk '{print $3}' | tr -d '[]')

        # 跳过主仓库
        [[ "$wt_path" == "$main_wt" ]] && continue
        # 跳过 HEAD detached 状态
        [[ "$wt_branch" == "(HEAD" || -z "$wt_branch" ]] && continue

        # 用 gh pr list 检测该分支的 PR 是否已合并
        local pr_state=""
        if command -v gh &>/dev/null; then
            pr_state=$(gh pr list --head "$wt_branch" --state merged --json number -q '.[0].number' 2>/dev/null || echo "")
        fi

        if [[ -n "$pr_state" ]]; then
            echo -e "${YELLOW}移除已合并 worktree: $wt_path (分支: $wt_branch, PR #$pr_state)${NC}"
            git worktree remove --force "$wt_path" 2>/dev/null || true
            if [[ -d "$wt_path" ]]; then
                safe_rm_rf "$wt_path" "$worktree_base"
            fi
            git branch -D "$wt_branch" 2>/dev/null || true
            # set -e 下算术命令式自增在计数为 0 时退出码为 1 会中断脚本，必须用赋值式自增
            cleaned=$((cleaned + 1))
        else
            echo -e "  跳过: ${wt_branch}（未合并或无 PR）"
            skipped=$((skipped + 1))
        fi
    done < <(git worktree list 2>/dev/null | tail -n +2)

    echo ""
    echo -e "${GREEN}✅ 清理完成：移除 $cleaned 个，跳过 $skipped 个${NC}"
}

# v18.1.0 (Phase 7.1): 统一 session_id 识别。claude-launch.sh export
# $CLAUDE_SESSION_ID 后子进程 bash 调这里能直接读；fallback 到沿 PPID
# 链找 claude cmdline 的 --session-id 参数（Phase 7 既有路径）。
_resolve_claude_session_id() {
    # Phase 7.1: env var 优先（launcher export 的路径）
    if [[ -n "${CLAUDE_SESSION_ID:-}" ]]; then
        echo "$CLAUDE_SESSION_ID"
        return 0
    fi

    # Phase 7 fallback: 沿 PPID 链找 claude cmdline
    local pid="${PPID:-}"
    local depth=0
    while [[ -n "$pid" && "$pid" != "1" && $depth -lt 10 ]]; do
        local args
        args=$(ps -o args= "$pid" 2>/dev/null || echo "")
        if [[ "$args" == *"claude"* && "$args" == *"--session-id"* ]]; then
            echo "$args" | grep -oE '\-\-session-id[ =][a-f0-9-]+' | head -1 | awk '{print $NF}'
            return 0
        fi
        pid=$(ps -o ppid= "$pid" 2>/dev/null | tr -d ' ' || echo "")
        depth=$((depth + 1))
    done
    echo ""
}

# cmd_init_or_check — engine-worktree skill 调用入口
# 已在 worktree → 补齐 .dev-lock；在主仓库 → 调 cmd_create
cmd_init_or_check() {
    local task_name="${1:-}"
    local git_dir
    git_dir=$(git rev-parse --git-dir 2>/dev/null || echo "")

    if [[ "$git_dir" == *"worktrees"* ]]; then
        echo "✅ 已在 worktree 中"
        local current_branch project_root dev_mode_file dev_lock_file
        current_branch=$(git rev-parse --abbrev-ref HEAD)
        project_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
        dev_mode_file="$project_root/.dev-mode.${current_branch}"
        dev_lock_file="$project_root/.dev-lock.${current_branch}"

        if [[ ! -f "$dev_lock_file" ]]; then
            # v17.0.0: owner_session 必须是 Claude session UUID（从父 claude cmdline 解析），
            # 否则 Stop Hook 无法按 session_id 精确匹配
            local _claude_sid
            _claude_sid=$(_resolve_claude_session_id)
            [[ -z "$_claude_sid" ]] && _claude_sid="${CLAUDE_SESSION_ID:-unknown}"
            write_routing_dev_lock "$dev_lock_file" "$current_branch" "$_claude_sid" "$project_root"
            echo "✅ .dev-lock 已创建（owner_session=${_claude_sid}）"
        fi
    else
        echo "📍 当前在主仓库，创建 worktree"
        [[ -z "$task_name" ]] && { echo "❌ init-or-check 在主仓库需 task-name 参数"; exit 1; }
        cmd_create "$task_name"
    fi

    # 自检：脚本是子进程，无法 cd 调用方进程。区分两种情况：
    #   - 已在 worktree（调用方在 worktree 内调用）→ 验证分支格式
    #   - 在主仓库刚创建 worktree（cmd_create 已 echo 路径）→ 提示调用方 cd，不误判失败
    git_dir=$(git rev-parse --git-dir 2>/dev/null)
    local current_branch
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$git_dir" == *"worktrees"* ]]; then
        [[ ! "$current_branch" =~ ^cp- ]] && { echo "❌ 分支名不符合 cp-* 格式"; exit 1; }
        echo "✅ engine-worktree 自检通过（已在 worktree）"
    else
        echo "✅ worktree 已创建（见上方路径）。脚本无法 cd 调用方进程——请调用方 cd 进该 worktree 后再继续。" >&2
    fi
}

