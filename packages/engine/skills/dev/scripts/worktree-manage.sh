#!/usr/bin/env bash
# ZenithJoy Engine - Worktree 管理脚本
# v1.4.0: 自动创建 .dev-lock（含 tty/session_id），修复 Stop Hook 会话隔离
# v1.3.0: WORKTREE_BASE 支持 — 默认路径改为 ~/worktrees/{project}，跨会话持久化
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

# 生成 worktree 路径（v1.3.0: 默认使用 ~/worktrees/{project}，跨会话持久化）
# 环境变量 WORKTREE_BASE 可覆盖默认路径（默认: ~/worktrees）
generate_worktree_path() {
    local task_name="$1"
    local project_name
    project_name=$(get_project_name)

    # v1.3.0: 使用 WORKTREE_BASE 环境变量，默认 ~/worktrees
    # ~/worktrees/{project}/ 独立于主仓库目录，系统重启后依然存在
    local worktree_base="${WORKTREE_BASE:-$HOME/worktrees}"
    local base_path="${worktree_base}/${project_name}/${task_name}"
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

    # 数量上限检查（不含主仓库）
    # 支持环境变量覆盖，默认 15（8 个并发 content_publish + 若干 dev 任务）
    local MAX_WORKTREES="${MAX_WORKTREES:-15}"
    local existing_count
    existing_count=$(git worktree list 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')
    if [[ $existing_count -ge $MAX_WORKTREES ]]; then
        echo -e "${YELLOW}⚠️  worktree 数量已达上限（$existing_count/${MAX_WORKTREES}），尝试自动清理已合并的 worktree...${NC}" >&2
        cmd_cleanup
        existing_count=$(git worktree list 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')
        if [[ $existing_count -ge $MAX_WORKTREES ]]; then
            echo -e "${RED}ERROR: 清理后仍达上限（$existing_count/${MAX_WORKTREES}），所有 worktree 均为活跃状态${NC}" >&2
            echo "  运行以下命令查看现有 worktree：" >&2
            echo "  git worktree list" >&2
            exit 1
        fi
        echo -e "${GREEN}✅ 清理后可用，继续创建 worktree${NC}" >&2
    fi

    # 生成分支名和 worktree 路径
    local timestamp
    timestamp=$(date +%m%d%H%M%S)
    local branch_name="cp-${timestamp}-${task_name}"
    local worktree_path
    worktree_path=$(generate_worktree_path "$task_name")

    # 获取当前分支作为 base
    local base_branch
    base_branch=$(git rev-parse --abbrev-ref HEAD)

    # 如果在 cp-* 或 feature/* 分支，使用其 base 分支
    if [[ "${base_branch}" =~ ^(cp-|feature/) ]]; then
        local saved_base
        saved_base=$(git config "branch.${base_branch}.base-branch" 2>/dev/null || echo "")
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
    echo -e "${BLUE}更新 ${base_branch} 分支...${NC}" >&2

    # 获取主仓库路径
    local main_wt
    main_wt=$(get_main_worktree)

    # 在主仓库中更新 develop
    if git -C "$main_wt" rev-parse --verify "${base_branch}" &>/dev/null; then
        # 检查当前分支
        local current_branch
        current_branch=$(git -C "$main_wt" rev-parse --abbrev-ref HEAD)

        if [[ "$current_branch" == "${base_branch}" ]]; then
            # 如果当前在 base 分支上，用 pull
            if git -C "$main_wt" pull origin "${base_branch}" --ff-only 2>&2; then
                echo -e "${GREEN}✅ ${base_branch} 已更新${NC}" >&2
            else
                echo -e "${YELLOW}⚠️  无法更新 ${base_branch}，使用当前版本${NC}" >&2
            fi
        else
            # 不在 base 分支上，用 fetch + branch -f
            if git -C "$main_wt" fetch origin "${base_branch}" 2>&2; then
                if git -C "$main_wt" branch -f "${base_branch}" "origin/${base_branch}" 2>&2; then
                    echo -e "${GREEN}✅ ${base_branch} 已更新${NC}" >&2
                else
                    echo -e "${YELLOW}⚠️  无法更新 ${base_branch}，使用当前版本${NC}" >&2
                fi
            else
                echo -e "${YELLOW}⚠️  无法 fetch，使用当前版本${NC}" >&2
            fi
        fi
    fi
    echo "" >&2

    # v1.3.0: 确保 worktree 父目录存在（~/worktrees/{project}/）
    mkdir -p "$(dirname "$worktree_path")"

    # v1.3.0: 若 worktree 路径在主仓库内（兼容自定义 WORKTREE_BASE 指向仓库内），
    # 自动确保该路径在 .gitignore 中
    local gitignore_file="$main_wt/.gitignore"
    if [[ -f "$gitignore_file" && "$worktree_path" == "$main_wt"* ]]; then
        local rel_path="${worktree_path#$main_wt/}"
        local rel_dir
        rel_dir="$(dirname "$rel_path")/"
        if ! grep -qF "$rel_dir" "$gitignore_file" 2>/dev/null; then
            echo "" >> "$gitignore_file"
            echo "# Claude Code worktrees" >> "$gitignore_file"
            echo "${rel_dir}" >> "$gitignore_file"
            echo -e "${GREEN}✅ 已添加 ${rel_dir} 到 .gitignore${NC}" >&2
        fi
    fi

    echo -e "${BLUE}创建 Worktree...${NC}" >&2
    echo "  分支: $branch_name" >&2
    echo "  路径: $worktree_path" >&2
    echo "  Base: ${base_branch}" >&2
    echo "" >&2

    # 创建 worktree（同时创建新分支）
    if git worktree add -b "$branch_name" "$worktree_path" "${base_branch}" 2>&2; then
        # 保存 base 分支到 git config
        git config "branch.$branch_name.base-branch" "${base_branch}"

        echo -e "${GREEN}✅ Worktree 创建成功${NC}" >&2

        # v1.5.0: .dev-lock 写入 worktree 目录（不再写主仓库，防止跨会话污染）
        # Stop Hook 通过 _collect_search_dirs 扫描所有 worktree，能正确找到
        # v17.0.0: owner_session 从父 claude cmdline 解析，保证 Stop Hook 按 session_id 精确匹配
        local _claude_sid_create
        _claude_sid_create=$(_resolve_claude_session_id 2>/dev/null || echo "")
        [[ -z "$_claude_sid_create" ]] && _claude_sid_create="${CLAUDE_SESSION_ID:-unknown}"
        local dev_lock_file="$worktree_path/.dev-lock.${branch_name}"
        {
            echo "dev"
            echo "branch: ${branch_name}"
            echo "session_id: headed-$$-${branch_name}"
            echo "owner_session: ${_claude_sid_create}"
            echo "tty: $(tty 2>/dev/null || echo "none")"
            echo "worktree_path: ${worktree_path}"
            echo "created: $(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)"
        } > "$dev_lock_file"
        echo -e "${GREEN}✅ .dev-lock 已写入: .dev-lock.${branch_name}${NC}" >&2

        # v19.0.0: 同步写 .dev-mode 标准格式（stop-dev.sh 用文件存在性判 /dev 流程身份）
        local dev_mode_file="$worktree_path/.dev-mode.${branch_name}"
        if [[ ! -f "$dev_mode_file" ]]; then
            cat > "$dev_mode_file" <<DEV_MODE_EOF
dev
branch: ${branch_name}
session_id: ${_claude_sid_create:-unknown}
started: $(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)
step_1_spec: pending
harness_mode: false
DEV_MODE_EOF
            echo -e "${GREEN}✅ .dev-mode 已写入: .dev-mode.${branch_name}${NC}" >&2
        fi

        # v20.0.0 Ralph Loop 模式：项目根状态文件
        # 信号源切到主仓库根，不依赖 cwd 是否在 worktree
        # assistant 删 .dev-mode 不影响 — stop-dev.sh 看这个文件判定 dev 流程
        local main_repo
        main_repo=$(git rev-parse --show-toplevel 2>/dev/null)
        if [[ -n "$main_repo" ]]; then
            mkdir -p "$main_repo/.cecelia"
            cat > "$main_repo/.cecelia/dev-active-${branch_name}.json" <<RALPH_EOF
{
  "branch": "${branch_name}",
  "worktree": "${worktree_path}",
  "started_at": "$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)",
  "session_id": "${_claude_sid_create:-unknown}"
}
RALPH_EOF
            echo -e "${GREEN}✅ .cecelia/dev-active-${branch_name}.json 已写入主仓库根${NC}" >&2
        fi

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
            ((cleaned++))
        else
            echo -e "  跳过: ${wt_branch}（未合并或无 PR）"
            ((skipped++))
        fi
    done < <(git worktree list 2>/dev/null | tail -n +2)

    echo ""
    echo -e "${GREEN}✅ 清理完成：移除 $cleaned 个，跳过 $skipped 个${NC}"
}

# 主入口
main() {
    local cmd="${1:-}"
    shift || true

    case "$cmd" in
        create)
            cmd_create "$@"
            ;;
        init-or-check)
            cmd_init_or_check "$@"
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
            echo "  worktree-manage.sh create <task-name>         创建新 worktree"
            echo "  worktree-manage.sh init-or-check <task-name>  确保在 worktree（engine-worktree skill 入口）"
            echo "  worktree-manage.sh list                       列出所有 worktree"
            echo "  worktree-manage.sh remove <branch>            移除指定 worktree"
            echo "  worktree-manage.sh cleanup                    清理已合并的 worktree"
            exit 1
            ;;
    esac
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
        pid=$(ps -o ppid= "$pid" 2>/dev/null | tr -d ' ')
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
            cat > "$dev_lock_file" <<LOCKEOF
dev
branch: ${current_branch}
session_id: headed-$(date +%s)-$$-${current_branch}
owner_session: ${_claude_sid}
tty: $(tty 2>/dev/null || echo "none")
created: $(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)
LOCKEOF
            echo "✅ .dev-lock 已创建（owner_session=${_claude_sid}）"
        fi
    else
        echo "📍 当前在主仓库，创建 worktree"
        [[ -z "$task_name" ]] && { echo "❌ init-or-check 在主仓库需 task-name 参数"; exit 1; }
        cmd_create "$task_name"
    fi

    # 自检
    git_dir=$(git rev-parse --git-dir 2>/dev/null)
    local current_branch
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    [[ "$git_dir" != *"worktrees"* ]] && { echo "❌ 未在 worktree 中"; exit 1; }
    [[ ! "$current_branch" =~ ^cp- ]] && { echo "❌ 分支名不符合 cp-* 格式"; exit 1; }
    echo "✅ engine-worktree 自检通过"
}

# 仅作为可执行脚本时跑 main；被 source 时跳过（让测试能拉函数）
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
