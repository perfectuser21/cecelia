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

# 共享凭据正则模式（credential-guard + bash-guard 共用）
# 用法: for p in "${TOKEN_PATTERNS[@]}"; do grep -qE "$p" ...; done
TOKEN_PATTERNS=(
    'ntn_[a-zA-Z0-9]{20,}'                                          # Notion API Key
    'github_pat_[a-zA-Z0-9_]{30,}'                                  # GitHub PAT (new format)
    'ghp_[a-zA-Z0-9]{36}'                                           # GitHub Personal Access Token (classic)
    'gho_[a-zA-Z0-9]{36}'                                           # GitHub OAuth Token
    'ghs_[a-zA-Z0-9]{36}'                                           # GitHub Server-to-server Token
    'ghu_[a-zA-Z0-9]{36}'                                           # GitHub User-to-server Token
    'sk-proj-[a-zA-Z0-9_-]{40,}'                                    # OpenAI API Key
    'eyJ[a-zA-Z0-9_-]{50,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+'       # JWT tokens
    'dop_v1_[a-zA-Z0-9]{50,}'                                       # DigitalOcean
    'cli_[a-zA-Z0-9]{16,}'                                          # Feishu App ID
)

# 检查文本是否包含真实凭据
# 用法: if text_contains_token "$text"; then ... fi
# 返回: 0=包含凭据, 1=无凭据
text_contains_token() {
    local text="$1"
    for pattern in "${TOKEN_PATTERNS[@]}"; do
        if echo "$text" | grep -qE "$pattern"; then
            if echo "$text" | grep -qE '(YOUR_|example|placeholder|xxx)'; then
                continue
            fi
            return 0
        fi
    done
    return 1
}
