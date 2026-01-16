#!/bin/bash
# ZenithJoy Engine - 分支保护 Hook（版本见 package.json）
# 检查：必须在 cp-* 分支
# 保护：代码文件 + 重要目录（skills/, hooks/, .github/）
# 不需要状态文件 — 纯 git 检测

set -e

# 检查 jq 是否存在
if ! command -v jq &>/dev/null; then
  echo "⚠️ jq 未安装，分支保护 Hook 无法正常工作" >&2
  echo "   请安装: apt install jq 或 brew install jq" >&2
  exit 0  # 不阻止操作，但警告用户
fi

# Read JSON input from stdin
INPUT=$(cat)

# Extract tool name
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // .operation // empty')

# Only check Write/Edit operations
if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
    exit 0
fi

# Extract file path
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
    exit 0
fi

# ===== 判断是否需要保护 =====
NEEDS_PROTECTION=false

# 1. 重要目录：skills/, hooks/, .github/ 下的所有文件都要保护
if [[ "$FILE_PATH" == *"/skills/"* ]] || \
   [[ "$FILE_PATH" == *"/hooks/"* ]] || \
   [[ "$FILE_PATH" == *"/.github/"* ]]; then
    NEEDS_PROTECTION=true
fi

# 2. 代码文件：根据扩展名判断
EXT="${FILE_PATH##*.}"
case "$EXT" in
    ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|hpp|rb|php|swift|kt|sh)
        NEEDS_PROTECTION=true
        ;;
esac

# 不需要保护的文件直接放行
if [[ "$NEEDS_PROTECTION" == "false" ]]; then
    exit 0
fi

# ===== 以下是需要保护的文件，执行检查 =====

# Get current git branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# No git = allow
if [[ -z "$CURRENT_BRANCH" ]]; then
    exit 0
fi

# ===== 唯一检查: 必须在 cp-* 分支（格式：cp-<name>，name 必须存在）=====
if [[ ! "$CURRENT_BRANCH" =~ ^cp-[a-zA-Z0-9] ]]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  ❌ 只能在 cp-* 分支修改代码" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "当前分支: $CURRENT_BRANCH" >&2
    echo "要修改的文件: $FILE_PATH" >&2
    echo "" >&2
    echo "正确流程:" >&2
    echo "  1. 运行 /dev 开始开发工作流" >&2
    echo "  2. 在 cp-* 分支上开发" >&2
    echo "" >&2
    echo "[SKILL_REQUIRED: dev]" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2
fi

# All checks passed
exit 0
