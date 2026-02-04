#!/usr/bin/env bash
# ============================================================================
# Hook 共享工具函数
# ============================================================================
# 用法: source "$(dirname "$0")/../lib/hook-utils.sh"
# ============================================================================

# 清理数值：移除非数字字符，空值默认为 0
# 用法: clean_number "123abc" => "123"
#       clean_number "" => "0"
clean_number() {
    local val="${1:-0}"
    val="${val//[^0-9]/}"
    echo "${val:-0}"
}

# 带 timeout 的命令执行
# 用法: run_with_timeout <timeout_seconds> <command...>
# 返回值: 0=成功, 1=失败, 124=超时
run_with_timeout() {
    local timeout_sec="$1"
    shift

    # 检查 timeout 命令是否可用
    if command -v timeout &>/dev/null; then
        timeout "$timeout_sec" "$@"
        return $?
    else
        # 降级：没有 timeout 命令，直接运行（有风险）
        "$@"
        return $?
    fi
}

# 获取项目根目录
# 用法: PROJECT_ROOT=$(get_project_root)
get_project_root() {
    git rev-parse --show-toplevel 2>/dev/null || pwd
}

# 获取当前分支名
# 用法: BRANCH=$(get_current_branch)
get_current_branch() {
    git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"
}

# 检查是否在保护分支
# 用法: if is_protected_branch; then ... fi
is_protected_branch() {
    local branch="${1:-$(get_current_branch)}"
    [[ "$branch" == "main" || "$branch" == "master" || "$branch" == "develop" ]]
}

# Debug 日志（通过 HOOK_DEBUG=1 环境变量启用）
# 用法: debug_log "message"
debug_log() {
    if [[ "${HOOK_DEBUG:-0}" == "1" ]]; then
        echo "[DEBUG] $*" >&2
    fi
}
