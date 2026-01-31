#!/usr/bin/env bash
# ============================================================================
# CI Status: 统一 CI 状态查询库
# ============================================================================
# 提供带重试的 CI 状态查询，消除多处不一致的 gh 命令
#
# v1.0.0: 初始版本
#   - get_ci_status: 统一查询（带重试）
#   - is_ci_passed / is_ci_running / is_ci_failed: 便捷判断
#   - get_failed_run_id: 获取失败 run ID
# ============================================================================

# 默认重试配置
CI_MAX_RETRIES="${CI_MAX_RETRIES:-3}"
CI_RETRY_DELAY="${CI_RETRY_DELAY:-5}"

# 获取 CI 状态（带重试）
# 参数: branch [repo]
# 输出: JSON {"status":"...","conclusion":"...","run_id":"..."}
# 返回: 0=成功获取, 1=查询失败
get_ci_status() {
    local branch="$1"
    local repo="${2:-}"
    local retries=0
    local repo_flag=""

    if [[ -n "$repo" ]]; then
        repo_flag="--repo $repo"
    fi

    if ! command -v gh &>/dev/null; then
        echo '{"status":"unknown","conclusion":"","run_id":""}'
        return 1
    fi

    while [[ $retries -lt $CI_MAX_RETRIES ]]; do
        local run_info
        # shellcheck disable=SC2086
        run_info=$(gh run list --branch "$branch" --limit 1 \
            --json status,conclusion,databaseId $repo_flag 2>/dev/null) || true

        if [[ -n "$run_info" && "$run_info" != "[]" ]]; then
            local status conclusion run_id
            status=$(echo "$run_info" | jq -r '.[0].status // "unknown"')
            conclusion=$(echo "$run_info" | jq -r '.[0].conclusion // ""')
            run_id=$(echo "$run_info" | jq -r '.[0].databaseId // ""')

            echo "{\"status\":\"$status\",\"conclusion\":\"$conclusion\",\"run_id\":\"$run_id\"}"
            return 0
        fi

        retries=$((retries + 1))
        if [[ $retries -lt $CI_MAX_RETRIES ]]; then
            sleep "$CI_RETRY_DELAY"
        fi
    done

    echo '{"status":"unknown","conclusion":"","run_id":""}'
    return 1
}

# CI 是否通过
is_ci_passed() {
    local branch="$1"
    local repo="${2:-}"
    local result
    result=$(get_ci_status "$branch" "$repo")

    local status conclusion
    status=$(echo "$result" | jq -r '.status')
    conclusion=$(echo "$result" | jq -r '.conclusion')

    [[ "$status" == "completed" && "$conclusion" == "success" ]]
}

# CI 是否运行中
is_ci_running() {
    local branch="$1"
    local repo="${2:-}"
    local result
    result=$(get_ci_status "$branch" "$repo")

    local status
    status=$(echo "$result" | jq -r '.status')

    [[ "$status" == "in_progress" || "$status" == "queued" || \
       "$status" == "waiting" || "$status" == "pending" ]]
}

# CI 是否失败
is_ci_failed() {
    local branch="$1"
    local repo="${2:-}"
    local result
    result=$(get_ci_status "$branch" "$repo")

    local status conclusion
    status=$(echo "$result" | jq -r '.status')
    conclusion=$(echo "$result" | jq -r '.conclusion')

    [[ "$status" == "completed" && "$conclusion" != "success" ]]
}

# 获取失败的 run ID
get_failed_run_id() {
    local branch="$1"
    local repo="${2:-}"
    local result
    result=$(get_ci_status "$branch" "$repo")

    local status conclusion run_id
    status=$(echo "$result" | jq -r '.status')
    conclusion=$(echo "$result" | jq -r '.conclusion')
    run_id=$(echo "$result" | jq -r '.run_id')

    if [[ "$status" == "completed" && "$conclusion" != "success" && -n "$run_id" ]]; then
        echo "$run_id"
    fi
}
