#!/usr/bin/env bash
# Credential Guard Hook
# 拦截写入代码时包含真实凭据的操作
# Token 正则来自 lib/hook-utils.sh（与 bash-guard.sh 共享）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/hook-utils.sh
source "$SCRIPT_DIR/../lib/hook-utils.sh"

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.command // ""')

# 跳过凭据目录本身
if [[ "$FILE_PATH" == *".credentials"* ]]; then
    exit 0
fi

# 跳过非代码目录
if [[ "$FILE_PATH" == "/tmp"* ]] || [[ "$FILE_PATH" == *".log"* ]]; then
    exit 0
fi

# 获取要写入的内容
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // ""')

# 如果没有内容，放行
if [[ -z "$CONTENT" ]]; then
    exit 0
fi

# 检测真实凭据（使用共享函数）
if text_contains_token "$CONTENT"; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [CREDENTIAL GUARD] 检测到真实凭据" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "禁止将 API Key/Token 写入代码文件。" >&2
    echo "" >&2
    echo "正确做法：" >&2
    echo "  1. 凭据存储到 ~/.credentials/<service>.env" >&2
    echo "  2. 代码中用 process.env.XXX 或占位符" >&2
    echo "  3. .env.example 只放 YOUR_XXX_KEY 格式" >&2
    echo "" >&2
    echo "使用 /credentials skill 管理凭据。" >&2
    echo "" >&2
    exit 2
fi

exit 0
