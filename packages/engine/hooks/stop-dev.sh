#!/usr/bin/env bash
# ============================================================================
# Stop Hook: Claude Code 协议适配器 v15.4.0
# ============================================================================
# 这是 Claude Code Stop Hook 的协议适配器。
# 完成判断逻辑已提取到 lib/devloop-check.sh（Provider-Agnostic SSOT）。
#
# 此文件职责：
#   1. 读取 .dev-lock.<branch> 状态文件，进行会话隔离
#   2. 调用 devloop_check() 获取完成状态
#   3. 将结果转换为 Claude Code JSON API 格式输出
#   4. 输出 exit 0（允许结束）或 exit 2（强制继续）
#
# 此文件永远不需要修改业务逻辑——只改 lib/devloop-check.sh。
#
# v15.3.0: worktree 感知 — .dev-lock/.dev-mode 搜索扫描主仓库 + 所有 worktree
# v15.1.0: 活跃锁文件 — 在 worktree 内维护 .dev-session-active，防止 GC 误删
# v15.0.0: 提取完成判断逻辑到 lib/devloop-check.sh（provider-agnostic）
# v14.0.0: 删除所有旧格式兼容代码，只保留 per-branch 格式
# ============================================================================

set -euo pipefail

# ===== Worktree 感知：收集所有可能存放 .dev-lock/.dev-mode 的目录 =====
# 主仓库 + 所有 worktree 目录（状态文件可能在 worktree 内而非主仓库）
_collect_search_dirs() {
    local root="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
    echo "$root"
    while IFS= read -r _wt_line; do
        if [[ "$_wt_line" == "worktree "* ]]; then
            local _wt_path="${_wt_line#worktree }"
            [[ "$_wt_path" == "$root" ]] && continue
            [[ -d "$_wt_path" ]] && echo "$_wt_path"
        fi
    done < <(git -C "$root" worktree list --porcelain 2>/dev/null)
}

# ===== 无头模式：不再旁路，与有头模式使用同一套状态机 =====
# Headless 也必须检查 .dev-mode：
#   - 有 .dev-mode → exit 2 继续循环
#   - 无 .dev-mode → exit 0 允许结束
# （后续会统一检查 .dev-mode，这里不做特殊处理）

# ===== 加载共享库 =====
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT_EARLY="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# 尝试加载 lock-utils（项目内 > 全局）
LOCK_UTILS=""
# v2.0: 搜索路径加入 packages/engine/lib/（monorepo 结构）
for candidate in "$PROJECT_ROOT_EARLY/lib/lock-utils.sh" "$PROJECT_ROOT_EARLY/packages/engine/lib/lock-utils.sh" "$SCRIPT_DIR/../lib/lock-utils.sh" "$HOME/.claude/lib/lock-utils.sh"; do
    if [[ -f "$candidate" ]]; then
        LOCK_UTILS="$candidate"
        break
    fi
done

# 尝试加载 ci-status（项目内 > 全局）
CI_STATUS_LIB=""
for candidate in "$PROJECT_ROOT_EARLY/lib/ci-status.sh" "$PROJECT_ROOT_EARLY/packages/engine/lib/ci-status.sh" "$SCRIPT_DIR/../lib/ci-status.sh" "$HOME/.claude/lib/ci-status.sh"; do
    if [[ -f "$candidate" ]]; then
        CI_STATUS_LIB="$candidate"
        break
    fi
done

# ===== v15.0.0: 加载 devloop-check.sh（Provider-Agnostic SSOT）=====
# 完成判断逻辑的唯一来源，所有 Provider 适配器共用
DEVLOOP_CHECK_LIB=""
for candidate in "$PROJECT_ROOT_EARLY/packages/engine/lib/devloop-check.sh" "$PROJECT_ROOT_EARLY/lib/devloop-check.sh" "$SCRIPT_DIR/../lib/devloop-check.sh" "$HOME/.claude/lib/devloop-check.sh"; do
    if [[ -f "$candidate" ]]; then
        DEVLOOP_CHECK_LIB="$candidate"
        break
    fi
done

# shellcheck disable=SC1090
[[ -n "$LOCK_UTILS" ]] && source "$LOCK_UTILS"
# shellcheck disable=SC1090
[[ -n "$CI_STATUS_LIB" ]] && source "$CI_STATUS_LIB"
# shellcheck disable=SC1090
[[ -n "$DEVLOOP_CHECK_LIB" ]] && source "$DEVLOOP_CHECK_LIB"

# v12.41.0 P1-3 修复：jq 不存在时提供极简 shim
# 防止 set -e 下 jq 命令找不到导致整个脚本崩溃（exit 127）
# 流程控制只依赖 exit code（0/2），jq 输出是给 Claude Code 的提示信息
if ! command -v jq &>/dev/null; then
    jq() { cat >/dev/null 2>&1; echo '{}'; }
fi

# ===== D6-1 修复：session 预检查（mutex 之前）— 无匹配则直接 exit 0 =====
# 先做会话隔离检查，避免无关会话在 mutex 等待队列中阻塞
_PRE_TTY=$(tty 2>/dev/null || echo "")
_PRE_SESSION_ID="${CLAUDE_SESSION_ID:-}"
_PRE_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
_PRE_MATCHED=false

# v15.3.0: 扫描主仓库 + 所有 worktree 目录（状态文件可能在 worktree 内）
while IFS= read -r _pre_search_dir; do
for _pre_lock in "$_pre_search_dir"/.dev-lock.*; do
    [[ -f "$_pre_lock" ]] || continue
    _pre_lock_tty=$(grep "^tty:" "$_pre_lock" 2>/dev/null | cut -d' ' -f2- | xargs 2>/dev/null || echo "")
    _pre_lock_session=$(grep "^session_id:" "$_pre_lock" 2>/dev/null | cut -d' ' -f2 | xargs 2>/dev/null || echo "")
    _pre_lock_branch=$(grep "^branch:" "$_pre_lock" 2>/dev/null | cut -d' ' -f2 | xargs 2>/dev/null || echo "")

    # TTY 匹配
    if [[ -n "$_pre_lock_tty" && "$_pre_lock_tty" != "not a tty" && -n "$_PRE_TTY" && "$_PRE_TTY" != "not a tty" ]]; then
        if [[ "$_pre_lock_tty" == "$_PRE_TTY" ]]; then
            _PRE_MATCHED=true; break 2
        fi
    # session_id 匹配
    elif [[ -n "$_pre_lock_session" && -n "$_PRE_SESSION_ID" && "$_pre_lock_session" == "$_PRE_SESSION_ID" ]]; then
        _PRE_MATCHED=true; break 2
    # 无头模式：branch 匹配
    elif [[ -z "$_PRE_TTY" || "$_PRE_TTY" == "not a tty" ]] && [[ -z "$_PRE_SESSION_ID" ]]; then
        if [[ -n "$_pre_lock_branch" && "$_pre_lock_branch" == "$_PRE_BRANCH" ]]; then
            _PRE_MATCHED=true; break 2
        fi
    # v15.2.0 修复：lock 无标识符（tty=not-a-tty/空 + session_id=空）→ 按分支匹配任意会话
    # 场景：lock 创建时会话无 TTY 且无 SESSION_ID，但当前会话有 SESSION_ID（有头模式）
    # 原 case 1/2/3 均无法命中，导致 _PRE_MATCHED=false → exit 0 → /dev 中途退出
    elif [[ ("$_pre_lock_tty" == "not a tty" || -z "$_pre_lock_tty") && -z "$_pre_lock_session" ]]; then
        if [[ -n "$_pre_lock_branch" && "$_pre_lock_branch" == "$_PRE_BRANCH" ]]; then
            _PRE_MATCHED=true; break 2
        fi
    fi
done
done < <(_collect_search_dirs "$PROJECT_ROOT_EARLY")

if [[ "$_PRE_MATCHED" == "false" ]]; then
    # 无任何匹配的 .dev-lock → 此会话无 dev 流程，直接退出，不竞争 mutex
    exit 0
fi

# ===== P0-2 修复：获取并发锁，防止多个会话同时操作 =====
if [[ -n "$LOCK_UTILS" ]] && type acquire_dev_mode_lock &>/dev/null; then
    if ! acquire_dev_mode_lock 2; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [Stop Hook: 并发锁获取失败]" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "  另一个会话正在执行 Stop Hook，请稍后重试" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        jq -n --arg reason "另一个会话正在执行 Stop Hook，等待锁释放后继续检查完成条件" '{"decision": "block", "reason": $reason}'
        exit 2
    fi
else
    # Fallback: 内联锁（v2.0: flock 缺失检测 + FD 201 避免与 retry_count 块的 FD 200 冲突）
    if command -v flock &>/dev/null; then
        LOCK_DIR="$(git rev-parse --git-dir 2>/dev/null)" || LOCK_DIR="/tmp"
        LOCK_FILE="$LOCK_DIR/cecelia-stop.lock"
        exec 201>"$LOCK_FILE"
        if ! flock -w 2 201; then
            echo "" >&2
            echo "  [Stop Hook: 并发锁获取失败]" >&2
            jq -n --arg reason "并发锁获取失败，等待锁释放后继续" '{"decision": "block", "reason": $reason}'
            exit 2
        fi
    fi
    # macOS 无 flock → 跳过锁（best-effort，单用户场景竞态概率极低）
fi

# ===== 读取 Hook 输入（JSON） =====
# v2.0 P2-18 修复：加超时防止 stdin 阻塞（1 秒超时）
HOOK_INPUT=$(timeout 1 cat 2>/dev/null || echo "{}")

# ===== 重试计数器（用于 Pipeline Patrol 触发判断）=====
# v15.4.0: 去掉 30 次硬限制，改为 pipeline_rescue 机制
# retry_count 仍然递增（用于监控），但不再强制退出
# 卡住时向 Brain 注册 pipeline_rescue 任务让 Patrol 处理
RESCUE_CHECK_INTERVAL=15  # 每 15 次检查一次是否需要 rescue

# ===== 获取项目根目录 =====
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# v15.1.0: 活跃锁文件路径（在 BRANCH_NAME 确定后填充，此处先声明避免 set -u 报错）
_WT_ACTIVE_PATH=""

# ===== Helper: 清理状态文件（不删 worktree 目录）=====
# v12.39.1: worktree 目录删除改由外部 worktree-gc.sh 负责（从主仓库运行）
# 此函数只负责删除 .dev-mode/.dev-lock/.dev-sentinel 状态文件
force_cleanup_worktree() {
    local mode_file="$1"
    # 只删状态文件，worktree 目录由外部 GC 清理
    # 不再尝试 git worktree remove（在 worktree 内部执行会失败）
    return 0
}

# ===== Helper: 回写步骤状态到 Brain custom_props =====
# 每次 Stop Hook 运行时，将当前 /dev 步骤状态写入 Brain tasks.custom_props
# 依赖：.dev-mode 中有 brain_task_id 字段（通过 --task-id 启动时写入）
report_step_to_brain() {
    local mode_file="${1:-$DEV_MODE_FILE}"
    [[ -n "$mode_file" && -f "$mode_file" ]] || return 0

    # 读取 brain_task_id（优先）或兼容旧格式的 task_id
    local task_id
    task_id=$(grep "^brain_task_id:" "$mode_file" 2>/dev/null | awk '{print $2}' || echo "")
    [[ -z "$task_id" ]] && task_id=$(grep "^task_id:" "$mode_file" 2>/dev/null | awk '{print $2}' || echo "")
    [[ -z "$task_id" ]] && return 0  # 无 task_id，跳过

    # 确定当前最新完成的步骤（按步骤倒序查找第一个 done）
    local step_num=0
    local step_name="init"
    if grep -q "^step_4_ship: done" "$mode_file" 2>/dev/null; then
        step_num=4; step_name="ship"
    elif grep -q "^step_3_integrate: done" "$mode_file" 2>/dev/null; then
        step_num=3; step_name="integrate"
    elif grep -q "^step_2_code: done" "$mode_file" 2>/dev/null; then
        step_num=2; step_name="code"
    elif grep -q "^step_1_spec: done" "$mode_file" 2>/dev/null; then
        step_num=1; step_name="spec"
    elif grep -q "^step_0_worktree: done" "$mode_file" 2>/dev/null; then
        step_num=0; step_name="worktree"
    # LEGACY: 旧字段兼容（Pipeline v1 编号），新代码使用 devloop-check.sh 路径
    elif grep -q "^step_5_clean: done" "$mode_file" 2>/dev/null; then
        step_num=4; step_name="ship"  # LEGACY: step_5_clean → step_4_ship
    elif grep -q "^step_4_learning: done" "$mode_file" 2>/dev/null; then
        step_num=4; step_name="ship"  # LEGACY: step_4_learning → step_4_ship
    elif grep -q "^step_3_prci: done" "$mode_file" 2>/dev/null; then
        step_num=3; step_name="integrate"  # LEGACY: step_3_prci → step_3_integrate
    elif grep -q "^step_1_taskcard: done" "$mode_file" 2>/dev/null; then
        step_num=1; step_name="spec"  # LEGACY: step_1_taskcard → step_1_spec
    fi

    # 读取分支名
    local branch
    branch=$(grep "^branch:" "$mode_file" 2>/dev/null | awk '{print $2}' || echo "")

    # 构建 custom_props payload
    local updated_at
    updated_at=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
    local payload
    payload=$(printf '{"dev_step":%d,"dev_step_name":"%s","branch":"%s","updated_at":"%s"}' \
        "$step_num" "$step_name" "$branch" "$updated_at")

    # 调用 Brain PATCH API（非阻塞，失败不影响主流程）
    curl -s -X PATCH "http://localhost:5221/api/brain/tasks/${task_id}" \
        -H "Content-Type: application/json" \
        -d "{\"custom_props\":${payload}}" \
        --max-time 3 2>/dev/null || true
}

# ===== Helper: 保存阻塞原因到 .dev-mode =====
# v2.0 P2-19 修复：过滤换行符防止注入多行到 .dev-mode
save_block_reason() {
    local reason="${1//$'\n'/ }"
    local mode_file="$DEV_MODE_FILE"
    [[ -n "$mode_file" && -f "$mode_file" ]] || return 0
    {
        flock -x 201
        grep -v "^last_block_reason:" "$mode_file" > "$mode_file.reason.tmp" 2>/dev/null || true
        echo "last_block_reason: $reason" >> "$mode_file.reason.tmp"
        mv "$mode_file.reason.tmp" "$mode_file"
    } 201>"$mode_file.reason.lock" 2>/dev/null || {
        if [[ "$(uname)" == "Darwin" ]]; then
            sed -i '' "/^last_block_reason:/d" "$mode_file" 2>/dev/null || true
        else
            sed -i "/^last_block_reason:/d" "$mode_file" 2>/dev/null || true
        fi
        echo "last_block_reason: $reason" >> "$mode_file"
    }
}

# ===== 检查 per-branch 状态文件（双钥匙状态机）=====
# .dev-lock.<branch>（硬钥匙）+ .dev-mode.<branch>（软状态）+ .dev-sentinel.<branch>（三重保险）
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# ===== 动态发现当前会话的状态文件 =====
# 查找 per-branch 格式（.dev-lock.<branch>）
_CURRENT_TTY=$(tty 2>/dev/null || echo "")
_CURRENT_SESSION_ID="${CLAUDE_SESSION_ID:-}"
DEV_LOCK_FILE=""
DEV_MODE_FILE=""
SENTINEL_FILE=""

# v15.3.0: 扫描主仓库 + 所有 worktree 目录（状态文件可能在 worktree 内）
while IFS= read -r _main_search_dir; do
for _lock_file in "$_main_search_dir"/.dev-lock.*; do
    [[ -f "$_lock_file" ]] || continue
    _lock_tty=$(grep "^tty:" "$_lock_file" 2>/dev/null | cut -d' ' -f2- | xargs 2>/dev/null || echo "")
    _lock_session=$(grep "^session_id:" "$_lock_file" 2>/dev/null | cut -d' ' -f2 | xargs 2>/dev/null || echo "")
    _branch_in_lock=$(grep "^branch:" "$_lock_file" 2>/dev/null | cut -d' ' -f2 | xargs 2>/dev/null || echo "")
    _matched=false

    # TTY 匹配（有头模式首选）
    if [[ -n "$_lock_tty" && "$_lock_tty" != "not a tty" && -n "$_CURRENT_TTY" && "$_CURRENT_TTY" != "not a tty" ]]; then
        if [[ "$_lock_tty" == "$_CURRENT_TTY" ]]; then
            _matched=true
        fi
    # session_id 匹配（TTY 不可用时 fallback）
    elif [[ -n "$_lock_session" && -n "$_CURRENT_SESSION_ID" && "$_lock_session" == "$_CURRENT_SESSION_ID" ]]; then
        _matched=true
    # v12.41.0 P0-2 修复：TTY 和 session_id 都为空（纯无头模式）→ 用当前分支名匹配
    # 无头模式下 tty="" 且 CLAUDE_SESSION_ID="" 时，上面两个条件都不满足，
    # 导致扫描循环匹配不到任何 lock → DEV_LOCK_FILE="" → exit 0（Stop Hook 失效）
    elif [[ -z "$_CURRENT_TTY" || "$_CURRENT_TTY" == "not a tty" ]] && [[ -z "$_CURRENT_SESSION_ID" ]]; then
        if [[ -n "$_branch_in_lock" && "$_branch_in_lock" == "$CURRENT_BRANCH" ]]; then
            _matched=true
        fi
    # v15.2.0 修复：lock 无标识符（tty=not-a-tty/空 + session_id=空）→ 按分支匹配任意会话
    # 场景：lock 创建时会话无 TTY 且无 SESSION_ID，但当前会话有 SESSION_ID（有头模式）
    # 原 case 1/2/3 均无法命中，导致 DEV_LOCK_FILE="" → exit 0 → /dev 中途退出
    elif [[ ("$_lock_tty" == "not a tty" || -z "$_lock_tty") && -z "$_lock_session" ]]; then
        if [[ -n "$_branch_in_lock" && "$_branch_in_lock" == "$CURRENT_BRANCH" ]]; then
            _matched=true
        fi
    fi

    if [[ "$_matched" == "true" && -n "$_branch_in_lock" ]]; then
        DEV_LOCK_FILE="$_lock_file"
        # v15.3.0: 状态文件在 lock 所在目录（可能是 worktree 而非 PROJECT_ROOT）
        _lock_dir="$(dirname "$_lock_file")"
        DEV_MODE_FILE="$_lock_dir/.dev-mode.${_branch_in_lock}"
        SENTINEL_FILE="$_lock_dir/.dev-sentinel.${_branch_in_lock}"
        break 2
    fi
done
done < <(_collect_search_dirs "$PROJECT_ROOT")

# Key-1: .dev-lock.<branch>（硬钥匙）- 只要它在，就必须走 dev 检查
if [[ -z "$DEV_LOCK_FILE" ]]; then
    # 没有匹配的 .dev-lock → 检查孤儿 .dev-mode.* 文件（泄漏清理）
    # v15.3.0: 扫描主仓库 + 所有 worktree 目录
    while IFS= read -r _orphan_search_dir; do
    for _orphan_mode in "$_orphan_search_dir"/.dev-mode.*; do
        [[ -f "$_orphan_mode" ]] || continue
        _orphan_branch=$(grep "^branch:" "$_orphan_mode" 2>/dev/null | cut -d' ' -f2 || echo "")
        _orphan_dir="$(dirname "$_orphan_mode")"
        _orphan_lock="$_orphan_dir/.dev-lock.${_orphan_branch}"
        if [[ -n "$_orphan_branch" && ! -f "$_orphan_lock" ]]; then
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "  [Stop Hook: 状态文件泄漏（孤儿 .dev-mode）]" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "" >&2
            echo "  ⚠️  .dev-lock.${_orphan_branch} 不存在但 .dev-mode 存在（泄漏）" >&2
            echo "  清理泄漏文件..." >&2
            force_cleanup_worktree "$_orphan_mode" || true
            rm -f "$_orphan_mode" "$_orphan_dir/.dev-sentinel.${_orphan_branch}"
            echo "  ✅ 已清理" >&2
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        fi
    done
    done < <(_collect_search_dirs "$PROJECT_ROOT")

    # 没有任何 dev 状态文件 → 普通会话，允许结束
    exit 0
fi

# .dev-lock.<branch> 存在，检查 .dev-mode.<branch>（软状态）
if [[ ! -f "$DEV_MODE_FILE" ]]; then
    # lock 存在但 mode 不存在 → 状态丢失，用计数器追踪重试次数
    _ORPHAN_RETRY_FILE="$PROJECT_ROOT/.dev-orphan-retry-lock"
    _ORPHAN_COUNT=0
    if [[ -f "$_ORPHAN_RETRY_FILE" ]]; then
        _ORPHAN_COUNT=$(cat "$_ORPHAN_RETRY_FILE" 2>/dev/null || echo "0")
        _ORPHAN_COUNT=${_ORPHAN_COUNT//[^0-9]/}
        _ORPHAN_COUNT=${_ORPHAN_COUNT:-0}
    fi
    _ORPHAN_COUNT=$((_ORPHAN_COUNT + 1))
    echo "$_ORPHAN_COUNT" > "$_ORPHAN_RETRY_FILE"

    if [[ $_ORPHAN_COUNT -gt 5 ]]; then
        # 超过 5 次 → 清理孤儿 lock，允许退出
        echo "  ⚠️  .dev-lock 孤儿重试 $_ORPHAN_COUNT 次，强制清理" >&2
        rm -f "$DEV_LOCK_FILE" "$SENTINEL_FILE" "$_ORPHAN_RETRY_FILE"
        exit 0
    fi

    # .dev-lock 在但 .dev-mode 不在 → 状态丢失/创建失败/被删除
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [Stop Hook: 状态文件丢失 (${_ORPHAN_COUNT}/5)]" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "  ⚠️  .dev-lock 存在但 .dev-mode 缺失" >&2
    echo "  可能原因:" >&2
    echo "    - .dev-mode 创建失败（Write 工具 git 污染）" >&2
    echo "    - .dev-mode 被误删（cleanup.sh / 手动 rm / AI）" >&2
    echo "" >&2
    echo "  下一步：重建 .dev-mode 或执行最小检查" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    jq -n --arg reason ".dev-lock 存在但 .dev-mode 缺失，阻止退出（${_ORPHAN_COUNT}/5）" '{"decision": "block", "reason": $reason}'
    exit 2  # ← 强制阻止退出（双钥匙核心机制）
fi

# ===== 检查 cleanup 是否已完成 =====
# 优先检查 cleanup_done: true（向后兼容旧版本）
if grep -q "cleanup_done: true" "$DEV_MODE_FILE" 2>/dev/null; then
    force_cleanup_worktree "$DEV_MODE_FILE"
    # v2.0 P1-10 修复：正常退出时清理 orphan retry 计数器 + P2-28: .dev-failure.log
    rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE" "$SENTINEL_FILE" \
          "$PROJECT_ROOT/.dev-orphan-retry-sentinel" "$PROJECT_ROOT/.dev-orphan-retry-lock" \
          "$PROJECT_ROOT/.dev-orphan-retry" "$PROJECT_ROOT/.dev-failure.log"
    # v15.1.0: session 正常结束，删除 worktree 内的活跃锁文件
    [[ -n "$_WT_ACTIVE_PATH" && -d "$_WT_ACTIVE_PATH" ]] && rm -f "$_WT_ACTIVE_PATH/.dev-session-active" 2>/dev/null || true
    exit 0
fi

# v12.8.0: 删除了"11步全部done"的提前退出逻辑
#
# 问题：步骤状态可能被错误标记（如 CI 未通过但 step_9_ci 被标记为 done），
#       导致 Stop Hook 在实际 CI 检查之前就认为"完成"并退出
#
# 修复：步骤状态（step_*）只用于进度展示（TaskList），不用于流程控制
#       流程控制只依赖实际状态检查：PR 创建 → CI 通过 → PR 合并 → cleanup_done
#
# 详见：.prd-cp-02071917-stop-hook-fix.md

# ===== 读取并递增重试次数（用于监控，无硬上限）=====
# Bug fix: 使用 awk 替代 cut，避免多空格问题
# v15.1.0: 超时检查移到 devloop_check 之后，先判断完成状态再判断超时
RETRY_COUNT=$(grep "^retry_count:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "0")
RETRY_COUNT=${RETRY_COUNT//[^0-9]/}  # 清理非数字字符
RETRY_COUNT=${RETRY_COUNT:-0}        # 空值默认为 0

# Bug fix: 先递增计数器，再检查上限（修复 off-by-one 错误）
# 原逻辑：检查 >= 15 后才递增，导致实际第 16 次才失败
RETRY_COUNT=$((RETRY_COUNT + 1))

# 更新重试次数（Bug fix: 原子更新 + 跨平台 sed 兼容）
# 注意: RETRY_COUNT 已在上面递增，这里直接写入当前值
# v2.0 P1-9 修复：使用 FD 202（避免与 lock-utils FD 和 fallback FD 201 冲突）
{
    flock -x 202
    grep -v "^retry_count:" "$DEV_MODE_FILE" > "$DEV_MODE_FILE.tmp" 2>/dev/null || true
    echo "retry_count: $RETRY_COUNT" >> "$DEV_MODE_FILE.tmp"
    mv "$DEV_MODE_FILE.tmp" "$DEV_MODE_FILE"
} 202>"$DEV_MODE_FILE.lock" 2>/dev/null || {
    # flock 失败时的 fallback（不中断流程）
    # Bug fix: 使用跨平台兼容的 sed 语法（macOS 和 Linux）
    # macOS sed -i 需要 '' 参数，Linux 不需要
    if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' "/^retry_count:/d" "$DEV_MODE_FILE" 2>/dev/null || true
    else
        sed -i "/^retry_count:/d" "$DEV_MODE_FILE" 2>/dev/null || true
    fi
    echo "retry_count: $RETRY_COUNT" >> "$DEV_MODE_FILE"
}

# ===== 读取 .dev-mode 内容 =====
DEV_MODE=$(head -1 "$DEV_MODE_FILE" 2>/dev/null || echo "")
BRANCH_IN_FILE=$(grep "^branch:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2 || echo "")

# 如果不是 dev 模式 — .dev-lock 存在但 .dev-mode 首行被损坏
# 安全默认：阻止退出（exit 2），不能静默放行
# PR #550 修复：之前 exit 0 导致状态文件写坏时 Stop Hook 完全失效
if [[ "$DEV_MODE" != "dev" ]]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [Stop Hook: .dev-mode 首行损坏]" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "  期望首行: dev" >&2
    echo "  实际首行: $DEV_MODE" >&2
    echo "  文件: $DEV_MODE_FILE" >&2
    echo "" >&2
    echo "  .dev-lock 存在说明 /dev 在运行中" >&2
    echo "  .dev-mode 首行损坏 → 安全默认阻止退出" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    save_block_reason ".dev-mode 首行损坏（期望 dev，实际 ${DEV_MODE}）"
    jq -n --arg reason ".dev-mode 首行损坏（期望 'dev'，实际 '${DEV_MODE}'）。.dev-lock 存在说明 /dev 在运行中，安全默认阻止退出。请重建 .dev-mode 文件：第一行必须是 'dev'，后跟 branch/session_id 等字段。" '{"decision": "block", "reason": $reason}'
    exit 2
fi

# ===== P0-3 修复：会话隔离 - 检查分支是否匹配 =====
# CURRENT_BRANCH 已在 line 134 获取，无需重复声明

# 如果 .dev-mode 中的分支与当前分支不匹配，删除泄漏的 .dev-mode 文件
# 这防止多个 Claude 会话"串线"（一个会话被迫接手另一个会话的任务）
if [[ -n "$BRANCH_IN_FILE" && "$BRANCH_IN_FILE" != "$CURRENT_BRANCH" ]]; then
    # 分支不匹配，说明 .dev-mode 泄漏了，删除它
    echo "  ⚠️  检测到泄漏的 .dev-mode 文件（分支 $BRANCH_IN_FILE，当前 $CURRENT_BRANCH）" >&2
    echo "  🧹 删除泄漏文件..." >&2
    rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE" "$SENTINEL_FILE"
    exit 0
fi

# ===== H7-008：TTY 隔离 - 有头模式下按 terminal 隔离 =====
TTY_IN_FILE=$(grep "^tty:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2- || echo "")
CURRENT_TTY=$(tty 2>/dev/null || echo "")

# 如果 .dev-mode 有有效 tty 字段且当前 TTY 可获取，检查是否匹配
if [[ -n "$TTY_IN_FILE" && "$TTY_IN_FILE" != "not a tty" && -n "$CURRENT_TTY" && "$CURRENT_TTY" != "not a tty" && "$TTY_IN_FILE" != "$CURRENT_TTY" ]]; then
    # 不是当前 terminal 的任务，允许结束
    exit 0
fi

# ===== P0-4 修复：session_id 验证 - 同分支多会话隔离 =====
SESSION_ID_IN_FILE=$(grep "^session_id:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2 || echo "")
CURRENT_SESSION_ID="${CLAUDE_SESSION_ID:-}"

# 如果 .dev-mode 有 session_id 且当前会话有 session_id，检查是否匹配
if [[ -n "$SESSION_ID_IN_FILE" && -n "$CURRENT_SESSION_ID" && "$SESSION_ID_IN_FILE" != "$CURRENT_SESSION_ID" ]]; then
    # 不是当前会话创建的任务，允许结束
    exit 0
fi

# 使用文件中的分支名（如果有），否则使用当前分支
BRANCH_NAME="${BRANCH_IN_FILE:-$CURRENT_BRANCH}"

# ===== 回写步骤状态到 Brain（非阻塞）=====
# 让 Brain 实时知道每个 /dev 任务在哪一步，Dashboard 可展示进度
report_step_to_brain "$DEV_MODE_FILE"

# ===== v15.1.0: 活跃锁文件 — 标记 worktree 正在被 session 使用（防 GC 误删）=====
# 查找 BRANCH_NAME 对应的 worktree 路径（从主仓库 git worktree list 读取）
_WT_ACTIVE_PATH=""
_worktree_root_dir=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [[ -n "$_worktree_root_dir" ]]; then
    _wt_current_path=""
    _wt_current_branch=""
    while IFS= read -r _wt_line; do
        if [[ "$_wt_line" == "worktree "* ]]; then
            _wt_current_path="${_wt_line#worktree }"
        elif [[ "$_wt_line" == "branch refs/heads/"* ]]; then
            _wt_current_branch="${_wt_line#branch refs/heads/}"
        elif [[ -z "$_wt_line" ]]; then
            if [[ "$_wt_current_branch" == "$BRANCH_NAME" && -n "$_wt_current_path" ]]; then
                _WT_ACTIVE_PATH="$_wt_current_path"
            fi
            _wt_current_path=""
            _wt_current_branch=""
        fi
    done < <(git -C "$_worktree_root_dir" worktree list --porcelain 2>/dev/null; echo "")
fi

# 在 worktree 内创建活跃锁文件（告知 GC：此 worktree 正在使用，不要删除）
if [[ -n "$_WT_ACTIVE_PATH" && -d "$_WT_ACTIVE_PATH" ]]; then
    touch "$_WT_ACTIVE_PATH/.dev-session-active" 2>/dev/null || true
fi

# ===== 验签完整性检查（State Machine 三层防御 P0+P1）=====
# 检查关键步骤 seal：step_N done 但无对应验签 → exit 2 强制补验
_SEAL_FILE="$PROJECT_ROOT/.dev-seal.${BRANCH_NAME}"
# worktree fallback: 如果主路径没找到 seal，在 DEV_LOCK_FILE 所在目录或 worktree 活跃路径找
if [[ ! -f "$_SEAL_FILE" ]]; then
    _seal_dir=$(dirname "$DEV_LOCK_FILE" 2>/dev/null || echo "")
    if [[ -n "$_seal_dir" && -f "$_seal_dir/.dev-seal.${BRANCH_NAME}" ]]; then
        _SEAL_FILE="$_seal_dir/.dev-seal.${BRANCH_NAME}"
    fi
    if [[ ! -f "$_SEAL_FILE" && -n "${_WT_ACTIVE_PATH:-}" && -f "$_WT_ACTIVE_PATH/.dev-seal.${BRANCH_NAME}" ]]; then
        _SEAL_FILE="$_WT_ACTIVE_PATH/.dev-seal.${BRANCH_NAME}"
    fi
fi
_SEALED_STEPS=("step_1_spec" "step_2_code" "step_4_ship")
_SEAL_FAIL=false
for _step in "${_SEALED_STEPS[@]}"; do
    if grep -q "^${_step}: done" "$DEV_MODE_FILE" 2>/dev/null; then
        if ! grep -q "^${_step}_seal: verified" "$_SEAL_FILE" 2>/dev/null; then
            echo "  ⚠️  [STATE MACHINE] ${_step} 标记为 done 但无验签" >&2
            echo "     验签文件: ${_SEAL_FILE}" >&2
            echo "     请重新执行该步骤让 verify-step.sh 生成验签" >&2
            _SEAL_FAIL=true
        fi
    fi
done
if [[ "$_SEAL_FAIL" == "true" ]]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [Stop Hook: 验签缺失 — 强制重新执行未验证步骤]" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    save_block_reason "State Machine 验签缺失"
    jq -n '{"decision": "block", "reason": "State Machine 验签缺失：step_N 标记 done 但 verify-step.sh 验签不存在。请重新执行相应步骤，让 verify-step.sh 生成 .dev-seal 验签。"}'
    exit 2
fi

# v4.1: Agent Seal（Gate 2）已删除 — 审查由 Codex Gate（spec_review/code_review_gate）替代
# 旧的 .dev-agent-seal 检查在 Pipeline v2 中不再需要

echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  [Stop Hook: /dev 完成条件检查]" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2
echo "  分支: $BRANCH_NAME" >&2
echo "" >&2

# ===== v15.0.0: 调用 devloop-check.sh（Provider-Agnostic SSOT）=====
# 完成判断逻辑统一在 lib/devloop-check.sh，此处只做协议转换
# 此段代码永远不需要修改——只改 lib/devloop-check.sh

if [[ -n "$DEVLOOP_CHECK_LIB" ]] && type devloop_check &>/dev/null; then
    # === 使用 devloop-check.sh 统一判断 ===
    DEVLOOP_RESULT=$(devloop_check "$BRANCH_NAME" "$DEV_MODE_FILE") || DEVLOOP_RC=$?
    DEVLOOP_RC="${DEVLOOP_RC:-0}"
    DEVLOOP_STATUS=$(echo "$DEVLOOP_RESULT" | jq -r '.status // "blocked"' 2>/dev/null || echo "blocked")

    echo "  devloop_check 状态: $DEVLOOP_STATUS" >&2

    if [[ "$DEVLOOP_STATUS" == "done" ]]; then
        echo "  🎉 工作流完成！正在清理..." >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        force_cleanup_worktree "$DEV_MODE_FILE"
        rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE" "$SENTINEL_FILE" \
              "$PROJECT_ROOT/.dev-orphan-retry-sentinel" "$PROJECT_ROOT/.dev-orphan-retry-lock" \
              "$PROJECT_ROOT/.dev-orphan-retry" "$PROJECT_ROOT/.dev-failure.log"
        # v15.1.0: session 正常结束，删除 worktree 内的活跃锁文件
        [[ -n "$_WT_ACTIVE_PATH" && -d "$_WT_ACTIVE_PATH" ]] && rm -f "$_WT_ACTIVE_PATH/.dev-session-active" 2>/dev/null || true
        jq -n '{"decision": "allow", "reason": "PR 已合并且 Stage 4 完成，工作流结束"}'
        exit 0
    else
        # blocked — 将 devloop_check 的 reason+action 转换为 Claude Code JSON 格式
        DEVLOOP_REASON=$(echo "$DEVLOOP_RESULT" | jq -r '.reason // "未知原因"' 2>/dev/null || echo "未知原因")
        DEVLOOP_ACTION=$(echo "$DEVLOOP_RESULT" | jq -r '.action // ""' 2>/dev/null || echo "")
        DEVLOOP_PR=$(echo "$DEVLOOP_RESULT" | jq -r '.pr_number // ""' 2>/dev/null || echo "")
        DEVLOOP_RUN_ID=$(echo "$DEVLOOP_RESULT" | jq -r '.ci_run_id // ""' 2>/dev/null || echo "")

        COMBINED_REASON="$DEVLOOP_REASON"
        if [[ -n "$DEVLOOP_ACTION" ]]; then
            COMBINED_REASON="${DEVLOOP_REASON}。下一步：${DEVLOOP_ACTION}。⚠️ 立即执行，禁止询问用户。"
        fi

        echo "  原因: $DEVLOOP_REASON" >&2
        [[ -n "$DEVLOOP_ACTION" ]] && echo "  行动: $DEVLOOP_ACTION" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

        # ===== v15.4.0: Pipeline Rescue 机制（替代 30 次硬限制）=====
        # 不再强制退出。卡住时检查 Brain 是否已有 pipeline_rescue 任务：
        #   - 没有 → 创建一个（让 Pipeline Patrol 处理）
        #   - 已有 → 继续等待（exit 2）
        # retry_count 仍然递增用于监控，但不再作为退出条件
        if [[ $RETRY_COUNT -gt 0 && $(( RETRY_COUNT % RESCUE_CHECK_INTERVAL )) -eq 0 ]]; then
            RESCUE_BRANCH=$(grep "^branch:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "unknown")
            RESCUE_REASON=$(grep "^last_block_reason:" "$DEV_MODE_FILE" 2>/dev/null | sed 's/^last_block_reason: //' || echo "unknown")
            RESCUE_TASK_ID=$(grep "^brain_task_id:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "")
            [[ -z "$RESCUE_TASK_ID" ]] && RESCUE_TASK_ID=$(grep "^task_id:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "")

            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "  [Stop Hook: Pipeline Rescue 检查（重试 #${RETRY_COUNT}）]" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

            # 检查 Brain 是否已有此分支的 pipeline_rescue 任务
            _RESCUE_EXISTS=false
            _RESCUE_QUERY=$(curl -s --max-time 5 \
                "http://localhost:5221/api/brain/tasks?task_type=pipeline_rescue&status=queued&status=in_progress" \
                2>/dev/null || echo "[]")
            if echo "$_RESCUE_QUERY" | python3 -c "
import json,sys
tasks=json.load(sys.stdin)
if isinstance(tasks,dict): tasks=tasks.get('tasks',tasks.get('data',[]))
if not isinstance(tasks,list): tasks=[]
branch='${RESCUE_BRANCH}'
found=any(branch in str(t.get('description',''))+str(t.get('title',''))+str(t.get('metadata','')) for t in tasks)
sys.exit(0 if found else 1)
" 2>/dev/null; then
                _RESCUE_EXISTS=true
            fi

            if [[ "$_RESCUE_EXISTS" == "true" ]]; then
                echo "  已有 pipeline_rescue 任务，继续等待 Patrol 处理..." >&2
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            else
                echo "  创建 pipeline_rescue 任务（让 Pipeline Patrol 接管）..." >&2
                RESCUE_DESC="任务 ${RESCUE_BRANCH} 在 ${RESCUE_REASON} 阶段卡住，Stop Hook 已重试 ${RETRY_COUNT} 次。需要 Patrol 诊断并修复。"
                RESCUE_PAYLOAD=$(jq -n \
                    --arg branch "$RESCUE_BRANCH" \
                    --argjson count "$RETRY_COUNT" \
                    --arg reason "$RESCUE_REASON" \
                    --arg task_id "${RESCUE_TASK_ID:-}" \
                    '{stuck_branch: $branch, retry_count: $count, last_status: $reason, original_task_id: $task_id}' 2>/dev/null \
                    || echo "{\"stuck_branch\":\"${RESCUE_BRANCH}\",\"retry_count\":${RETRY_COUNT},\"last_status\":\"${RESCUE_REASON}\"}")
                curl -s -X POST "http://localhost:5221/api/brain/tasks" \
                    -H "Content-Type: application/json" \
                    -d "$(jq -n \
                        --arg title "[rescue] 任务 ${RESCUE_BRANCH} 卡住 — 需要 Patrol 介入" \
                        --arg desc "$RESCUE_DESC" \
                        --argjson payload "$RESCUE_PAYLOAD" \
                        '{title: $title, description: $desc, priority: "P1", task_type: "pipeline_rescue", status: "queued", payload: $payload, trigger_source: "stop_hook_rescue"}' 2>/dev/null \
                        || echo "{\"title\":\"[rescue] 任务 ${RESCUE_BRANCH} 卡住\",\"priority\":\"P1\",\"task_type\":\"pipeline_rescue\",\"status\":\"queued\",\"trigger_source\":\"stop_hook_rescue\"}")" \
                    --max-time 5 2>/dev/null || true
                echo "  [Brain] 已创建 pipeline_rescue 任务" >&2
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            fi
            # 不退出，继续 exit 2 等待
        fi

        save_block_reason "$DEVLOOP_REASON"
        jq -n \
            --arg reason "$COMBINED_REASON" \
            --arg pr "${DEVLOOP_PR:-}" \
            --arg run_id "${DEVLOOP_RUN_ID:-}" \
            '{"decision": "block", "reason": $reason, "pr_number": $pr, "ci_run_id": $run_id}'
        exit 2
    fi

else
    # === Fallback: devloop-check.sh 未加载，使用旧内联逻辑 ===
    # 保留此 fallback 确保向后兼容（devloop-check.sh 未安装时不崩溃）
    echo "  ⚠️  devloop-check.sh 未加载，使用 fallback 逻辑" >&2

    # --- 条件 1: PR 创建？---
    PR_NUMBER=""
    PR_STATE=""

    if command -v gh &>/dev/null; then
        PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
        if [[ -n "$PR_NUMBER" ]]; then
            PR_STATE="open"
        else
            PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --state merged --json number -q '.[0].number' 2>/dev/null || echo "")
            [[ -n "$PR_NUMBER" ]] && PR_STATE="merged"
        fi
    fi

    if [[ -z "$PR_NUMBER" ]]; then
        save_block_reason "PR 未创建"
        jq -n --arg reason "PR 未创建，继续执行 Stage 3 创建 PR" '{"decision": "block", "reason": $reason}'
        exit 2
    fi

    echo "  ✅ 条件 1: PR 已创建 (#$PR_NUMBER)" >&2

    # --- 条件 2: CI 状态？---
    if [[ "$PR_STATE" != "merged" ]]; then
        CI_STATUS="unknown"
        CI_CONCLUSION=""
        CI_RUN_ID=""

        if [[ -n "$CI_STATUS_LIB" ]] && type get_ci_status &>/dev/null; then
            CI_RESULT=$(CI_MAX_RETRIES=2 CI_RETRY_DELAY=3 get_ci_status "$BRANCH_NAME") || true
            CI_STATUS=$(echo "$CI_RESULT" | jq -r '.status // "unknown"')
            CI_CONCLUSION=$(echo "$CI_RESULT" | jq -r '.conclusion // ""')
            CI_RUN_ID=$(echo "$CI_RESULT" | jq -r '.run_id // ""')
        else
            RUN_INFO=$(gh run list --branch "$BRANCH_NAME" --limit 1 --json status,conclusion,databaseId 2>/dev/null || echo "[]")
            if [[ "$RUN_INFO" != "[]" && -n "$RUN_INFO" ]]; then
                CI_STATUS=$(echo "$RUN_INFO" | jq -r '.[0].status // "unknown"')
                CI_CONCLUSION=$(echo "$RUN_INFO" | jq -r '.[0].conclusion // ""')
                CI_RUN_ID=$(echo "$RUN_INFO" | jq -r '.[0].databaseId // ""')
            fi
        fi

        case "$CI_STATUS" in
            "completed")
                if [[ "$CI_CONCLUSION" != "success" ]]; then
                    save_block_reason "CI 失败 ($CI_CONCLUSION)"
                    jq -n --arg reason "CI 失败（$CI_CONCLUSION），查看日志修复问题后重新 push" --arg run_id "${CI_RUN_ID:-unknown}" '{"decision": "block", "reason": $reason, "ci_run_id": $run_id}'
                    exit 2
                fi
                ;;
            "in_progress"|"queued"|"waiting"|"pending")
                save_block_reason "CI 进行中 ($CI_STATUS)"
                jq -n --arg reason "CI 进行中（$CI_STATUS），等待 CI 完成" '{"decision": "block", "reason": $reason}'
                exit 2
                ;;
            *)
                save_block_reason "CI 状态未知 ($CI_STATUS)"
                jq -n --arg reason "CI 状态未知（$CI_STATUS），检查 CI 状态" '{"decision": "block", "reason": $reason}'
                exit 2
                ;;
        esac
    fi

    # --- 条件 3: PR 合并？---
    if [[ "$PR_STATE" == "merged" ]]; then
        # 检查 step_4_ship；LEGACY: 兼容旧字段名 step_5_clean
        STEP_4_STATUS=$(grep "^step_4_ship:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "")
        [[ -z "$STEP_4_STATUS" ]] && STEP_4_STATUS=$(grep "^step_5_clean:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "pending")  # LEGACY: step_5_clean → step_4_ship
        if [[ "$STEP_4_STATUS" == "done" ]]; then
            force_cleanup_worktree "$DEV_MODE_FILE"
            rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE" "$SENTINEL_FILE" \
                  "$PROJECT_ROOT/.dev-orphan-retry-sentinel" "$PROJECT_ROOT/.dev-orphan-retry-lock" \
                  "$PROJECT_ROOT/.dev-orphan-retry" "$PROJECT_ROOT/.dev-failure.log"
            [[ -n "$_WT_ACTIVE_PATH" && -d "$_WT_ACTIVE_PATH" ]] && rm -f "$_WT_ACTIVE_PATH/.dev-session-active" 2>/dev/null || true
            jq -n '{"decision": "allow", "reason": "PR 已合并且 Stage 4 完成，工作流结束"}'
            exit 0
        else
            save_block_reason "PR 已合并，Stage 4 Ship 未完成"
            jq -n '{"decision": "block", "reason": "PR 已合并，执行 Stage 4 Ship（cleanup）"}'
            exit 2
        fi
    else
        # 检查 step_4_ship 或兼容旧字段名 step_4_learning
        STEP_4_STATUS=$(grep "^step_4_ship:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "")
        [[ -z "$STEP_4_STATUS" ]] && STEP_4_STATUS=$(grep "^step_4_learning:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "pending")
        if [[ "$STEP_4_STATUS" != "done" ]]; then
            save_block_reason "Stage 4 Ship 未完成"
            jq -n --arg reason "CI 通过，但 Stage 4 Ship（Learning）尚未完成。必须先完成 Learning 再合并 PR。" '{"decision": "block", "reason": $reason}'
            exit 2
        fi
        # v14.1.0: Learning 内容验证（flag=done 时额外验证实际内容格式）
        CHECK_LEARNING_SCRIPT=""
        for _candidate in "$PROJECT_ROOT/packages/engine/scripts/devgate/check-learning.sh" \
                          "$HOME/.claude/lib/check-learning.sh"; do
            if [[ -f "$_candidate" ]]; then
                CHECK_LEARNING_SCRIPT="$_candidate"
                break
            fi
        done
        if [[ -n "$CHECK_LEARNING_SCRIPT" ]]; then
            if ! bash "$CHECK_LEARNING_SCRIPT" >/dev/null 2>&1; then
                # 重置 step_4_ship 或兼容旧字段
                if [[ "$(uname)" == "Darwin" ]]; then
                    sed -i '' "s/^step_4_ship: done/step_4_ship: pending/" "$DEV_MODE_FILE" 2>/dev/null || true
                    sed -i '' "s/^step_4_learning: done/step_4_learning: pending/" "$DEV_MODE_FILE" 2>/dev/null || true
                else
                    sed -i "s/^step_4_ship: done/step_4_ship: pending/" "$DEV_MODE_FILE" 2>/dev/null || true
                    sed -i "s/^step_4_learning: done/step_4_learning: pending/" "$DEV_MODE_FILE" 2>/dev/null || true
                fi
                save_block_reason "Stage 4 Learning 内容格式不达标（check-learning.sh 失败）"
                jq -n --arg reason "Stage 4 flag=done 但 check-learning.sh 内容格式验证失败。Learning 必须包含：根本原因分析 + 下次预防措施 + 至少 50 字。请重新写 docs/learnings/<branch>.md，然后 git commit + push。" '{"decision": "block", "reason": $reason}'
                exit 2
            fi
        fi
        # v14.2.0: CI 通过 + Stage 4 完成 + Learning 验证通过 → 真正执行合并
        echo "[stop-dev] 自动合并 PR #$PR_NUMBER（CI 通过 + Stage 4 完成 + Learning 验证通过）..." >&2
        if gh pr merge "$PR_NUMBER" --squash --delete-branch 2>&1; then
            echo "[stop-dev] PR #$PR_NUMBER 已合并" >&2
            # 合并成功 → 执行 cleanup 并正常退出
            force_cleanup_worktree "$DEV_MODE_FILE"
            rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE" "$SENTINEL_FILE" \
                  "$PROJECT_ROOT/.dev-orphan-retry-sentinel" "$PROJECT_ROOT/.dev-orphan-retry-lock" \
                  "$PROJECT_ROOT/.dev-orphan-retry" "$PROJECT_ROOT/.dev-failure.log"
            [[ -n "$_WT_ACTIVE_PATH" && -d "$_WT_ACTIVE_PATH" ]] && rm -f "$_WT_ACTIVE_PATH/.dev-session-active" 2>/dev/null || true
            jq -n '{"decision": "allow", "reason": "PR 已自动合并且 cleanup 完成，工作流结束"}'
            exit 0
        else
            echo "[stop-dev] PR #$PR_NUMBER 合并失败" >&2
            save_block_reason "PR 合并失败 (#$PR_NUMBER)"
            jq -n --arg reason "PR #$PR_NUMBER 自动合并失败，请检查合并冲突或权限问题" '{"decision": "block", "reason": $reason}'
            exit 1
        fi
    fi
fi
