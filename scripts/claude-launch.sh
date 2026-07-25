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

# resume/continue 与强制注入的 --session-id 同用时，claude CLI 要求 --fork-session：
# 恢复的对话 fork 到本次 launcher 分配的新 session-id 下（与 per-session worktree 模型自洽）。
# 已知可接受边角：某 flag 的值恰为字符串 -r/-c 会误判追加（claude CLI 无此组合场景）。
_HAS_RESUME=0; _HAS_FORK=0
for arg in ${ARGS[@]+"${ARGS[@]}"}; do
    case "$arg" in
        --resume|--resume=*|-r|--continue|--continue=*|-c) _HAS_RESUME=1 ;;
        --fork-session) _HAS_FORK=1 ;;
    esac
done
if [[ "$_HAS_RESUME" == "1" && "$_HAS_FORK" == "0" ]]; then
    ARGS+=("--fork-session")
fi

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

# cwd 是否在任何 git 结构里。非 git 目录（cd ~; claude）压根没有历史要共享，
# 建链段必须整个跳过——否则每次启动都打一条"软链失败"警告，误导且高频。
_in_git_repo() { git rev-parse --git-dir &>/dev/null; }

# 主仓物理路径正向求出（在 linked worktree 内也有效）：
#   主仓：      git-dir == git-common-dir
#   linked wt： git-dir = <main>/.git/worktrees/<n>，git-common-dir = <main>/.git
# 判据与 packages/engine/hooks/main-repo-write-guard.sh 一致（cp-07051816 教训）。
# 绝不反推 project key —— key 是有损多对一映射（/ . 和原生 - 全塌成 -），
# 反推会把 zenithjoy-skills 的历史并进 zenithjoy 主池。
#
# ⚠️ 调用前置：仅在 _in_git_repo && ! _in_main_repo_worktree 为真时调用。
# bare repo（git-common-dir 即仓库本身 → dirname 给出其父目录）与 submodule
# （git-common-dir 在 .git/modules/<n> 下 → dirname 给出 modules 目录）都会返回
# 错值；二者当前都被 _in_main_repo_worktree 挡在门外，属**巧合安全**。
# 谁要改建链门禁，必须重新验这两种形态，别指望本函数自己兜底。
_resolve_main_repo() {
    local cmn
    cmn="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
    cmn="$(cd "$cmn" 2>/dev/null && pwd -P)" || return 1
    dirname "$cmn"
}

# 判断 $1 是否为 $2（主仓）登记承认的合法 worktree。
# 两个条件都要满足：目录自身认为在某个 git 结构里 + 主仓的 worktree 登记表里查得到它的物理路径。
# 只查前者不够——孤儿目录里残留的 .git 文件可能指向已经不存在的元数据。
_is_registered_worktree() {
    local dir="$1" main_repo="$2"
    local phys
    git -C "$dir" rev-parse --git-dir &>/dev/null || return 1
    phys="$(cd "$dir" 2>/dev/null && pwd -P)" || return 1
    git -C "$main_repo" worktree list --porcelain 2>/dev/null | grep -Fqx "worktree $phys"
}

# Claude Code projects key：绝对路径中**每个非字母数字字符**各替换为一个 -，
# 大小写与数字原样保留，逐字符替换不合并连续分隔符（纯 bash，免 fork）。
# 探针实证（2026-07-15）：
#   cwd /private/tmp/keyprobe/key_Probe.Test A/sub_dir
#   → -private-tmp-keyprobe-key-Probe-Test-A-sub-dir
# 旧实现只换 / 和 .，路径一旦含 _ / 空格，链名与 Claude 真实 key 对不上 → 链指空，
# 症状与"会话丢失"完全一致且极难归因。
_path_to_project_key() { printf '%s' "${1//[^a-zA-Z0-9]/-}"; }

# projects 池根目录。CLAUDE_PROJECTS_ROOT **仅供测试注入**——Claude Code 本体不读它
#（strings 实证 0 命中），生产必须由 CLAUDE_CONFIG_DIR 派生，与 claude 本体同源，
# 杜绝"测试绿、生产错"。
_proj_root() { printf '%s' "${CLAUDE_PROJECTS_ROOT:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects}"; }

# 启动时 sweep：扫描 projects root 中所有属于本项目 worktree key 的真实目录，
# 并回主仓池子并替换为软链。兜底历史遗留孤儿（launcher 早期版本无软链逻辑时
# Claude 直接在 worktree key 下建了真实目录，worktree 清理后永久卡在池外）。
# --ignore-existing 语义：目标已有同名文件则跳过，不覆盖。
# best-effort：任何失败只警告，绝不阻断 claude 启动。
# ⚠️ 调用前置：仅在 AUTO_WORKTREE=1（已设 _MAIN_REPO / _WT_BASE）时调用。
_sweep_orphan_wt_project_dirs() {
    local root main_target wt_base_phys wt_base_key entry fname f
    root="$(_proj_root)"
    main_target="$root/$(_path_to_project_key "$_MAIN_REPO")"
    mkdir -p "$main_target" 2>/dev/null || return 0
    # 物理化 worktree base 路径（与 Claude Code process.cwd() 一致）
    wt_base_phys="$(cd "$_WT_BASE" 2>/dev/null && pwd -P)" || wt_base_phys="$_WT_BASE"
    wt_base_key="$(_path_to_project_key "$wt_base_phys")-"
    local swept=0
    for entry in "$root"/${wt_base_key}*; do
        [[ -e "$entry" ]] || continue             # glob 无匹配时跳过
        [[ -d "$entry" && ! -L "$entry" ]] || continue   # 只处理真实目录
        [[ "$entry" == "$main_target" ]] && continue     # 跳过主仓自身
        # 迁移内容（ignore-existing：目标已有同名文件则跳过）
        for f in "$entry"/* "$entry"/.[!.]*; do
            [[ -e "$f" ]] || continue
            fname="$(basename "$f")"
            if [[ ! -e "$main_target/$fname" ]]; then
                mv "$f" "$main_target/" 2>/dev/null || true
            fi
        done
        # 替换为软链（要求目录已为空）
        if rmdir "$entry" 2>/dev/null; then
            ln -s "$main_target" "$entry" 2>/dev/null && swept=1 || true
        else
            echo "[claude-launch] ⚠️ sweep: $entry 有残留（同名冲突），跳过软链替换" >&2
        fi
    done
    if [[ "$swept" == "1" ]]; then
        echo "[claude-launch] ✅ sweep: 孤儿 worktree project key 已并回主仓池" >&2
    fi
}

AUTO_WORKTREE=0
if ! _is_headless && [[ "${CECELIA_NO_AUTO_WORKTREE:-0}" != "1" ]] && _in_main_repo_worktree; then
    AUTO_WORKTREE=1
fi

SID_SHORT="${SID:0:8}"
if [[ "$AUTO_WORKTREE" == "1" ]]; then
    _MAIN_REPO="$(git rev-parse --show-toplevel)"
    _PROJECT_NAME="$(basename "$_MAIN_REPO")"
    _WT_BASE="${WORKTREE_BASE:-$HOME/worktrees}/${_PROJECT_NAME}"
    _WT_BRANCH="session-${SID_SHORT}"
    _WT_PATH="${_WT_BASE}/${_WT_BRANCH}"
fi

# 账号切换必须早于 projects 软链与 dry-run：软链的 root 由 CLAUDE_CONFIG_DIR 派生
#（Claude Code 只认这个变量），解析晚于建链会把链建到错误账号池。
#
# 账号切换：claude-switch cs/cn 写入 ~/.claude/.active-account-dir
# 用 _is_headless 判断而非"CLAUDE_CONFIG_DIR 是否已设置"——后者会被从父 claude 进程
# 继承来的 env 误伤（嵌套 shell/session 里 CLAUDE_CONFIG_DIR 早已非空），导致
# claude-switch 在这类场景下永久失效。headless 调用（-p/--print）始终保留其
# 显式传入的 CLAUDE_CONFIG_DIR，不被 switch 文件覆盖。
if ! _is_headless; then
    _ACCT_DIR_FILE="$HOME/.claude/.active-account-dir"
    if [[ -f "$_ACCT_DIR_FILE" ]]; then
        _ACCT_DIR=$(cat "$_ACCT_DIR_FILE")
        if [[ -d "$_ACCT_DIR" ]]; then
            export CLAUDE_CONFIG_DIR="$_ACCT_DIR"
        fi
    fi
fi

# --dry-run 优先：CI / 测试环境无真 claude binary 也要能跑契约测试
# 输出格式与正常 exec 一致，含 --session-id <uuid>；触发自动 worktree 时额外输出建立步骤
if [[ "$DRY_RUN" == "1" ]]; then
    _CLAUDE_BIN="${CLAUDE_CODE_EXECPATH:-$(command -v claude 2>/dev/null || echo claude)}"
    if [[ "$AUTO_WORKTREE" == "1" ]]; then
        echo "git -C \"$_MAIN_REPO\" fetch origin main --quiet"
        echo "git -C \"$_MAIN_REPO\" worktree add \"$_WT_PATH\" -b \"$_WT_BRANCH\" origin/main"
        echo "cd \"$_WT_PATH\""
        _PROJ_ROOT="$(_proj_root)"
        # key 按物理路径派生（与 Claude Code process.cwd() 一致）；dry-run 时 worktree
        # 未建，cd 失败回退原字符串——dry-run 是意图契约，可接受。
        _WT_PHYS="$(cd "$_WT_PATH" 2>/dev/null && pwd -P)" || _WT_PHYS="$_WT_PATH"
        echo "ln -s \"$_PROJ_ROOT/$(_path_to_project_key "$_MAIN_REPO")\" \"$_PROJ_ROOT/$(_path_to_project_key "$_WT_PHYS")\""
    elif ! _is_headless && _in_git_repo && ! _in_main_repo_worktree; then
        # 已在外部建的 worktree 内：key 按当前 cwd 派生（cwd 真实存在，无需回退）
        _PROJ_ROOT="$(_proj_root)"
        _DR_MAIN="$(_resolve_main_repo)" && \
          echo "ln -s \"$_PROJ_ROOT/$(_path_to_project_key "$_DR_MAIN")\" \"$_PROJ_ROOT/$(_path_to_project_key "$(pwd -P)")\""
    fi
    echo "$_CLAUDE_BIN --session-id $SID ${ARGS[@]+${ARGS[@]}}"
    exit 0
fi

# 启动端是唯一知道 session 出处的地方。派发标记优先于 TTY；无法确定出处时不登记，
# 让采集端按未登记 session 失败关闭。登记失败不能阻塞 Claude，但连接等待最多 2 秒。
_register_session_provenance() {
    local kind launched_by task_id
    if [[ "${CECELIA_DISPATCH:-0}" == "1" ]]; then
        kind="machine"
        launched_by="${CECELIA_LAUNCHED_BY:-cecelia-dispatch}"
    elif [[ -t 0 && -t 1 ]]; then
        kind="human"
        launched_by="claude-launch-interactive"
    else
        return 0
    fi

    task_id="${HARNESS_TASK_ID:-}"
    # psql does not perform variable interpolation inside a -c argument. Feed the
    # statement over stdin so :'name' is resolved client-side before PostgreSQL
    # sees it; otherwise registration silently fails (failure is intentionally
    # non-blocking for Claude startup).
    PGCONNECT_TIMEOUT=2 psql cecelia -X -v ON_ERROR_STOP=1 \
        -v sid="$SID" -v kind="$kind" -v launched_by="$launched_by" -v task_id="$task_id" \
        >/dev/null 2>&1 <<'PROVENANCE_SQL' || true
INSERT INTO session_provenance(session_id,kind,launched_by,task_id)
VALUES (:'sid', :'kind', :'launched_by', NULLIF(:'task_id','')::uuid)
ON CONFLICT (session_id) DO NOTHING;
PROVENANCE_SQL
}

_register_session_provenance

# 真实执行：交互模式 + 主仓工作树 → 建立/复用 per-session worktree 并 cd 进去
if [[ "$AUTO_WORKTREE" == "1" ]]; then
    _sweep_orphan_wt_project_dirs || true
    mkdir -p "$_WT_BASE"

    # 孤儿目录自愈：目录存在但已不是主仓登记的合法 worktree（例如注册被意外摘除、
    # 目录残留）→ 备份后重建，不能静默把它当普通目录复用（session-isolation #3567）。
    if [[ -d "$_WT_PATH" ]] && ! _is_registered_worktree "$_WT_PATH" "$_MAIN_REPO"; then
        _ORPHAN_BACKUP="${_WT_PATH}.orphan-$(date +%s)"
        echo "[claude-launch] ⚠️ 孤儿 session 目录（非主仓登记 worktree）：$_WT_PATH → 备份到 $_ORPHAN_BACKUP" >&2
        mv "$_WT_PATH" "$_ORPHAN_BACKUP" \
            || { echo "[claude-launch] ❌ 备份孤儿目录失败，中止启动" >&2; exit 1; }
    fi

    if [[ ! -d "$_WT_PATH" ]]; then
        git -C "$_MAIN_REPO" fetch origin main --quiet 2>/dev/null || true
        # stdout 留给 claude 本体；git 的提示信息走 stderr
        if git -C "$_MAIN_REPO" rev-parse --verify "$_WT_BRANCH" &>/dev/null; then
            # 原分支还在（孤儿场景里分支未必被清理）→ checkout 已有分支，不能再 -b
            git -C "$_MAIN_REPO" worktree add "$_WT_PATH" "$_WT_BRANCH" 1>&2
        else
            git -C "$_MAIN_REPO" worktree add "$_WT_PATH" -b "$_WT_BRANCH" origin/main 1>&2
        fi
    fi
    cd "$_WT_PATH"
fi

# 会话历史软链：<wt_key> → <main_key>，让 transcript 汇聚主仓池子，/resume 可见全部历史。
# key 一律按物理路径派生（Claude Code 用 process.cwd()=物理路径取 key，
# ~/.claude/projects/ 实存 -private-tmp-* 条目为证；_MAIN_REPO 来自 git 已是物理路径）。
# best-effort：任何失败只警告，绝不阻断 claude 启动。
_link_projects_dir() {
    local wt_phys main_repo root target link f
    # 按最终 cwd 自解：调用点在 cd "$_WT_PATH" 之后，auto-worktree 路径同样正确。
    # 不读 $_WT_PATH/$_MAIN_REPO —— 它们只在 AUTO_WORKTREE=1 时才有值。
    wt_phys="$(pwd -P)" || return 1
    main_repo="$(_resolve_main_repo)" || return 1
    root="$(_proj_root)"
    target="$root/$(_path_to_project_key "$main_repo")"
    link="$root/$(_path_to_project_key "$wt_phys")"
    # 自指短路：link == target 时 ln -s X X 成环，/resume 遍历会 ELOOP
    [[ "$link" == "$target" ]] && return 0
    mkdir -p "$target" || return 1
    if [[ -L "$link" ]]; then
        if [[ "$(readlink "$link")" != "$target" ]]; then
            rm "$link" || return 1
            ln -s "$target" "$link" || return 1
        fi
    elif [[ -d "$link" ]]; then
        # 孤儿真实目录：内容并回主仓池子；同名冲突时跳过（不覆盖主仓版本）
        local _fname
        for f in "$link"/* "$link"/.[!.]*; do
            [[ -e "$f" ]] || continue
            _fname="$(basename "$f")"
            [[ -e "$target/$_fname" ]] || mv "$f" "$target/" 2>/dev/null || true
        done
        rmdir "$link" 2>/dev/null || return 1
        ln -s "$target" "$link" || return 1
    else
        ln -s "$target" "$link" || return 1
    fi
}

# 交互模式 + cwd 是 linked worktree → 建链，无论该 worktree 是 launcher 建的还是外部建的。
# 逃生阀 CECELIA_NO_AUTO_WORKTREE 只管"不建 worktree"，不参与建链判定——否则它会变成
# 新的丢会话入口（slot 复用 worktree 起 claude 时软链不建 → 历史落孤儿 key）。
if ! _is_headless && _in_git_repo && ! _in_main_repo_worktree; then
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
        # 软链**不删**：它是 per-worktree-path 的共享资源（同一 key 可压多条会话），
        # 不是 per-session 私有资源。删它会让仍在用该 key 的会话重建真目录 = 新孤儿。
        # 生产实证：key -…-session-9cc9a05b 下压过 4 条会话。
        # 一个软链 8 字节，留着零成本；要回收另跑 GC，不在会话退出路径上做。
    fi
fi

exit "$_CLAUDE_EXIT"
