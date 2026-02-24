#!/usr/bin/env bash
# Update Task status in Brain
# Usage: update-task-status.sh <task_id> <status>

set -euo pipefail

# Parameters
if [[ $# -lt 2 ]]; then
    echo "错误：缺少参数" >&2
    echo "用法: $0 <task_id> <status>" >&2
    echo "status 可选值: in_progress, completed, failed" >&2
    exit 1
fi

task_id="$1"
status="$2"

# Validate status value
if [[ ! "$status" =~ ^(in_progress|completed|failed)$ ]]; then
    echo "错误：无效的状态值: $status" >&2
    echo "允许的值: in_progress, completed, failed" >&2
    exit 1
fi

# Brain API configuration
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TIMEOUT=5

# Prepare request body
request_body=$(jq -n --arg status "$status" '{status: $status}')

# PATCH to Brain API
echo "🔄 更新 Task 状态: $task_id → $status..."

response=$(curl --fail --silent --max-time "$TIMEOUT" \
    -X PATCH "$BRAIN_URL/api/brain/tasks/$task_id" \
    -H "Content-Type: application/json" \
    -d "$request_body" \
    2>/dev/null || echo "")

# Check response
if [[ -z "$response" ]]; then
    echo "错误：Brain API 不可用 (URL: $BRAIN_URL)" >&2
    exit 1
fi

# Validate response format
if ! echo "$response" | jq empty 2>/dev/null; then
    echo "错误：Brain API 返回无效的 JSON" >&2
    exit 1
fi

# Check success status
if ! echo "$response" | jq -e '.success == true' > /dev/null 2>&1; then
    error_msg=$(echo "$response" | jq -r '.error // "未知错误"')
    echo "错误：状态更新失败 - $error_msg" >&2
    exit 1
fi

echo "✅ Task 状态已更新为: $status"
exit 0
