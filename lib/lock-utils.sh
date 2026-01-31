#!/usr/bin/env bash
# ============================================================================
# Lock Utils: .dev-mode 文件并发安全工具库
# ============================================================================
# 提供原子操作和锁机制，防止多会话竞态条件
#
# v1.0.0: 初始版本
#   - acquire_dev_mode_lock / release_dev_mode_lock: 写锁
#   - atomic_write_dev_mode / atomic_append_dev_mode: 原子操作
#   - get_session_id / check_session_match: 会话隔离
#   - create/check/remove_cleanup_signal: 协调信号
# ============================================================================

# 获取项目根目录和锁文件路径（内部使用）
_get_lock_paths() {
    local project_root
    project_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

    DEV_MODE_FILE="$project_root/.dev-mode"
    LOCK_DIR="$project_root/.git"
    LOCK_FILE="$LOCK_DIR/dev-mode.lock"

    if [[ ! -d "$LOCK_DIR" ]]; then
        LOCK_DIR="/tmp"
        LOCK_FILE="$LOCK_DIR/zenithjoy-dev-mode.lock"
    fi
}

# 获取当前会话 ID
# 优先级：CLAUDE_SESSION_ID > 随机生成
get_session_id() {
    if [[ -n "${CLAUDE_SESSION_ID:-}" ]]; then
        echo "$CLAUDE_SESSION_ID"
    else
        head -c 6 /dev/urandom 2>/dev/null | od -An -tx1 2>/dev/null | tr -d ' \n' || \
            date +%s%N | sha256sum | head -c 12
    fi
}

# 读取 .dev-mode 中的 session_id
get_dev_mode_session_id() {
    _get_lock_paths
    if [[ ! -f "$DEV_MODE_FILE" ]]; then
        echo ""
        return 0
    fi
    grep "^session_id:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2 || echo ""
}

# 读取 .dev-mode 中的分支名
get_dev_mode_branch() {
    _get_lock_paths
    if [[ ! -f "$DEV_MODE_FILE" ]]; then
        echo ""
        return 0
    fi
    grep "^branch:" "$DEV_MODE_FILE" 2>/dev/null | cut -d' ' -f2 || echo ""
}

# 获取 .dev-mode 写锁
# 参数: timeout (秒，默认 2)
# 返回: 0=成功, 1=失败
acquire_dev_mode_lock() {
    local timeout="${1:-2}"
    _get_lock_paths

    exec 200>"$LOCK_FILE"
    if ! flock -w "$timeout" 200; then
        return 1
    fi
    return 0
}

# 释放 .dev-mode 写锁
release_dev_mode_lock() {
    exec 200>&- 2>/dev/null || true
}

# 原子写入 .dev-mode 文件
# 参数: content (完整内容)
atomic_write_dev_mode() {
    local content="$1"
    _get_lock_paths

    local temp_file
    temp_file=$(mktemp "${DEV_MODE_FILE}.XXXXXX") || return 1

    echo "$content" > "$temp_file" || { rm -f "$temp_file"; return 1; }
    mv "$temp_file" "$DEV_MODE_FILE" || { rm -f "$temp_file"; return 1; }
    return 0
}

# 原子追加内容到 .dev-mode 文件
# 参数: line (要追加的行)
atomic_append_dev_mode() {
    local line="$1"
    _get_lock_paths

    if [[ ! -f "$DEV_MODE_FILE" ]]; then
        echo "$line" > "$DEV_MODE_FILE"
        return $?
    fi

    local temp_file
    temp_file=$(mktemp "${DEV_MODE_FILE}.XXXXXX") || return 1

    { cat "$DEV_MODE_FILE"; echo "$line"; } > "$temp_file" || { rm -f "$temp_file"; return 1; }
    mv "$temp_file" "$DEV_MODE_FILE" || { rm -f "$temp_file"; return 1; }
    return 0
}

# 检查会话是否匹配
# 参数: expected_session_id
# 返回: 0=匹配或无 session_id（向后兼容）, 1=不匹配
check_session_match() {
    local expected_session_id="$1"
    local file_session_id
    file_session_id=$(get_dev_mode_session_id)

    # 无 session_id 时向后兼容
    if [[ -z "$file_session_id" ]]; then
        return 0
    fi

    [[ "$file_session_id" == "$expected_session_id" ]]
}

# 创建协调信号（stop.sh 和 cleanup.sh 之间）
create_cleanup_signal() {
    local branch_name="$1"
    _get_lock_paths
    touch "$LOCK_DIR/cleanup-complete-${branch_name}"
}

# 检查协调信号是否存在
check_cleanup_signal() {
    local branch_name="$1"
    _get_lock_paths
    [[ -f "$LOCK_DIR/cleanup-complete-${branch_name}" ]]
}

# 删除协调信号
remove_cleanup_signal() {
    local branch_name="$1"
    _get_lock_paths
    /bin/rm -f "$LOCK_DIR/cleanup-complete-${branch_name}"
}
