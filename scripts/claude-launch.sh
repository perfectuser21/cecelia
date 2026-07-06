#!/usr/bin/env bash
# Cecelia 统一 claude 启动器
# 保证 headless / interactive / parallel 所有 claude 实例都有 --session-id + export 到子进程
# 交互模式下、cwd=主仓工作树时，自动建/复用 per-session worktree，隔离多 session 互踩（session 隔离根治）
# 用法：
#   直接用:     bash scripts/claude-launch.sh [-p PROMPT] [其他 claude 参数]
#   交互 alias:  alias claude='bash /absolute/path/to/scripts/claude-launch.sh'
#   headless:   CLAUDE_SESSION_ID=<uuid> bash scripts/claude-launch.sh -p "..."
#   dry-run:    bash scripts/claude-launch.sh --dry-run  → echo 最终命令行后 exit 0
#   逃生阀:     CECELIA_NO_AUTO_WORKTREE=1 bash scripts/claude-launch.sh  → 不自动建 worktree
set -euo pipefail

SID="${CLAUDE_SESSION_ID:-$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]' || cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null)}"
export CLAUDE_SESSION_ID="$SID"

# --dry-run 选项：解析参数，提取 --dry-run 标志
DRY_RUN=0
ARGS=()
for arg in "$@"; do
    if [[ "$arg" == "--dry-run" ]]; then
        DRY_RUN=1
    else
        ARGS+=("$arg")
    fi
done

# 是否 headless（-p/--print）—— headless 走 cecelia-run.sh 自己的 worktree 逻辑，不自动建 worktree
_is_headless() {
    local a
    for a in ${ARGS[@]+"${ARGS[@]}"}; do
        [[ "$a" == "-p" || "$a" == "--print" ]] && return 0
    done
    return 1
}

# 判断当前 cwd 是否在"主仓工作树"内（非 linked worktree）。
# 主仓：git rev-parse --git-dir == --git-common-dir；worktree 里两者不同
# （--git-dir 指向 .git/worktrees/<name>，--git-common-dir 指向共享 .git）。
_in_main_repo_worktree() {
    local gd cmn
    gd="$(git rev-parse --git-dir 2>/dev/null)" || return 1
    cmn="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
    [[ "$gd" == "$cmn" ]]
}

# Claude Code projects key：绝对路径中 / 和 . 逐字符替换为 -
_path_to_project_key() { printf '%s' "$1" | sed 's#[/.]#-#g'; }

AUTO_WORKTREE=0
if ! _is_headless && [[ "${CECELIA_NO_AUTO_WORKTREE:-0}" != "1" ]] && _in_main_repo_worktree; then
    AUTO_WORKTREE=1
fi

SID_SHORT="${SID:0:8}"
if [[ "$AUTO_WORKTREE" == "1" ]]; then
    _MAIN_REPO="$(git rev-parse --show-toplevel)"
    # macOS canonical 别名：/var /tmp /etc 是 /private/* 的符号链接，git 返回物理路径。
    # projects key 需与用户视角逻辑路径一致 → 同目录时剥掉 /private 前缀（Linux 无此前缀，no-op）。
    if [[ "$_MAIN_REPO" == /private/* && "${_MAIN_REPO#/private}" -ef "$_MAIN_REPO" ]]; then
        _MAIN_REPO="${_MAIN_REPO#/private}"
    fi
    _PROJECT_NAME="$(basename "$_MAIN_REPO")"
    _WT_BASE="${WORKTREE_BASE:-$HOME/worktrees}/${_PROJECT_NAME}"
    _WT_BRANCH="session-${SID_SHORT}"
    _WT_PATH="${_WT_BASE}/${_WT_BRANCH}"
fi

# --dry-run 优先：CI / 测试环境无真 claude binary 也要能跑契约测试
# 输出格式与正常 exec 一致，含 --session-id <uuid>；触发自动 worktree 时额外输出建立步骤
if [[ "$DRY_RUN" == "1" ]]; then
    _CLAUDE_BIN="${CLAUDE_CODE_EXECPATH:-$(command -v claude 2>/dev/null || echo claude)}"
    if [[ "$AUTO_WORKTREE" == "1" ]]; then
        echo "git -C \"$_MAIN_REPO\" fetch origin main --quiet"
        echo "git -C \"$_MAIN_REPO\" worktree add \"$_WT_PATH\" -b \"$_WT_BRANCH\" origin/main"
        echo "cd \"$_WT_PATH\""
        _PROJ_ROOT="${CLAUDE_PROJECTS_ROOT:-$HOME/.claude/projects}"
        echo "ln -s \"$_PROJ_ROOT/$(_path_to_project_key "$_MAIN_REPO")\" \"$_PROJ_ROOT/$(_path_to_project_key "$_WT_PATH")\""
    fi
    echo "$_CLAUDE_BIN --session-id $SID ${ARGS[@]+${ARGS[@]}}"
    exit 0
fi

# 真实执行：交互模式 + 主仓工作树 → 建立/复用 per-session worktree 并 cd 进去
if [[ "$AUTO_WORKTREE" == "1" ]]; then
    mkdir -p "$_WT_BASE"
    if [[ ! -d "$_WT_PATH" ]]; then
        git -C "$_MAIN_REPO" fetch origin main --quiet 2>/dev/null || true
        # stdout 留给 claude 本体；git 的提示信息走 stderr
        git -C "$_MAIN_REPO" worktree add "$_WT_PATH" -b "$_WT_BRANCH" origin/main 1>&2
    fi
    cd "$_WT_PATH"
fi

# 会话历史软链：<wt_key> → <main_key>，让 transcript 汇聚主仓池子，/resume 可见全部历史。
# best-effort：任何失败只警告，绝不阻断 claude 启动。
_link_projects_dir() {
    local root="${CLAUDE_PROJECTS_ROOT:-$HOME/.claude/projects}"
    local target link f
    target="$root/$(_path_to_project_key "$_MAIN_REPO")"
    link="$root/$(_path_to_project_key "$_WT_PATH")"
    mkdir -p "$target" || return 1
    if [[ -L "$link" ]]; then
        [[ "$(readlink "$link")" == "$target" ]] && return 0
        rm "$link" || return 1
    elif [[ -d "$link" ]]; then
        # 孤儿真实目录：内容并回主仓池子；任一 mv 失败则中止（保留真实目录，不建软链）
        for f in "$link"/* "$link"/.[!.]*; do
            [[ -e "$f" ]] || continue
            mv "$f" "$target/" || return 1
        done
        rmdir "$link" || return 1
    fi
    ln -s "$target" "$link"
}
if [[ "$AUTO_WORKTREE" == "1" ]]; then
    _link_projects_dir || echo "[claude-launch] ⚠️ projects 软链失败，本 session 历史将不共享（不影响启动）" >&2
fi

# Phase 7.6: 用绝对路径/command 跳过 shell function + alias，避免递归陷阱。
# Claude Code 的 shell-snapshots 会注入 'claude' shell function；在 bash 子进程里
# `exec claude` 会解析成该 function 反复调回 launcher 本身，表现为 "permission
# denied" 或死循环。优先级：CLAUDE_CODE_EXECPATH > PATH 里真 binary。
_CLAUDE_BIN="${CLAUDE_CODE_EXECPATH:-}"
if [[ -z "$_CLAUDE_BIN" || ! -x "$_CLAUDE_BIN" ]]; then
    _CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
fi
if [[ -z "$_CLAUDE_BIN" || ! -x "$_CLAUDE_BIN" ]]; then
    echo "[claude-launch] ❌ 找不到真 claude 可执行文件（CLAUDE_CODE_EXECPATH/\$PATH 都不行）" >&2
    exit 127
fi

# 账号切换：claude-switch cs/cn 写入 ~/.claude/.active-account-dir
if [[ -z "${CLAUDE_CONFIG_DIR:-}" ]]; then
    _ACCT_DIR_FILE="$HOME/.claude/.active-account-dir"
    if [[ -f "$_ACCT_DIR_FILE" ]]; then
        _ACCT_DIR=$(cat "$_ACCT_DIR_FILE")
        if [[ -d "$_ACCT_DIR" ]]; then
            export CLAUDE_CONFIG_DIR="$_ACCT_DIR"
        fi
    fi
fi

FINAL_CMD=("$_CLAUDE_BIN" --session-id "$SID" "${ARGS[@]+"${ARGS[@]}"}")

# 非自动 worktree 路径（headless / 已在 worktree / 逃生阀）：行为完全不变，exec 替换进程
if [[ "$AUTO_WORKTREE" != "1" ]]; then
    exec "${FINAL_CMD[@]}"
fi

# 自动 worktree 路径：不能用 exec —— claude 退出后要跑清理，前台执行 + 保留退出码
set +e
"${FINAL_CMD[@]}"
_CLAUDE_EXIT=$?
set -e

# 干净退出清理：worktree 无未提交改动、无 stash、无未推送 commit → 移除；脏的保留
_DIRTY=0
[[ -n "$(git -C "$_WT_PATH" status --porcelain 2>/dev/null)" ]] && _DIRTY=1
[[ -n "$(git -C "$_WT_PATH" stash list 2>/dev/null)" ]] && _DIRTY=1
if [[ "$_DIRTY" == "0" ]]; then
    if git -C "$_WT_PATH" rev-parse --verify "origin/${_WT_BRANCH}" &>/dev/null; then
        _UNPUSHED="$(git -C "$_WT_PATH" log "origin/${_WT_BRANCH}..HEAD" --oneline 2>/dev/null)"
    else
        _UNPUSHED="$(git -C "$_WT_PATH" log "origin/main..HEAD" --oneline 2>/dev/null)"
    fi
    if [[ -z "$_UNPUSHED" ]]; then
        git -C "$_MAIN_REPO" worktree remove "$_WT_PATH" --force >/dev/null 2>&1 || true
        git -C "$_MAIN_REPO" branch -D "$_WT_BRANCH" >/dev/null 2>&1 || true
        # 只删软链本身（-L 先验），绝不跟随进主仓文件夹
        _PROJ_LINK="${CLAUDE_PROJECTS_ROOT:-$HOME/.claude/projects}/$(_path_to_project_key "$_WT_PATH")"
        if [[ -L "$_PROJ_LINK" ]]; then rm "$_PROJ_LINK" 2>/dev/null || true; fi
    fi
fi

exit "$_CLAUDE_EXIT"
