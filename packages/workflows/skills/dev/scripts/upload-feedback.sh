#!/usr/bin/env bash
# Upload dev feedback report to Brain
# Usage: upload-feedback.sh <task_id> [feedback_file]

set -euo pipefail

# Parameters
if [[ $# -lt 1 ]]; then
    echo "错误：缺少 task_id 参数" >&2
    echo "用法: $0 <task_id> [feedback_file]" >&2
    exit 1
fi

task_id="$1"
feedback_file="${2:-.dev-feedback-report.json}"

# Brain API configuration
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TIMEOUT=5

# Validate feedback file exists
if [[ ! -f "$feedback_file" ]]; then
    echo "错误：反馈文件不存在: $feedback_file" >&2
    exit 1
fi

# Validate JSON format
if ! jq empty "$feedback_file" 2>/dev/null; then
    echo "错误：反馈文件不是有效的 JSON" >&2
    exit 1
fi

# Read feedback content
feedback=$(cat "$feedback_file")

# Prepare request body
request_body=$(jq -n --argjson feedback "$feedback" '{feedback: $feedback}')

# POST to Brain API
echo "📤 上传反馈到 Brain (Task: $task_id)..."

response=$(curl --fail --silent --max-time "$TIMEOUT" \
    -X POST "$BRAIN_URL/api/brain/tasks/$task_id/feedback" \
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
    echo "错误：反馈上传失败 - $error_msg" >&2
    exit 1
fi

echo "✅ 反馈已上传到 Brain"
exit 0
