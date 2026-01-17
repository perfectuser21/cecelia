#!/usr/bin/env bash
# ZenithJoy Engine - 分支保护 Hook（版本见 package.json）
# 检查：必须在 cp-* 分支 + 步骤状态机
# 保护：代码文件 + 重要目录（skills/, hooks/, .github/）

set -euo pipefail

# ===== 步骤定义 =====
# step=1 → 准备完成
# step=2 → PRD 完成
# step=3 → DoD 完成（可以写代码）
# step=4 → 代码完成
# step=5 → 测试完成
# step=6 → 本地测试通过（可以提交）
# step=7 → PR 已创建
# step=8 → CI + Codex 通过
# step=9 → 已合并
# step=10 → 已清理

# 检查 jq 是否存在
if ! command -v jq &>/dev/null; then
  echo "⚠️ jq 未安装，分支保护 Hook 无法正常工作" >&2
  echo "   请安装: apt install jq 或 brew install jq" >&2
  exit 0
fi

# Read JSON input from stdin
INPUT=$(cat)

# Extract tool name
if ! TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // .operation // empty' 2>/dev/null); then
    exit 0
fi

# Only check Write/Edit operations
if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
    exit 0
fi

# Extract file path
if ! FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .file_path // empty' 2>/dev/null); then
    exit 0
fi

if [[ -z "$FILE_PATH" ]]; then
    exit 0
fi

# ===== 判断是否需要保护 =====
NEEDS_PROTECTION=false

# 1. 重要目录
if [[ "$FILE_PATH" == *"/skills/"* ]] || \
   [[ "$FILE_PATH" == *"/hooks/"* ]] || \
   [[ "$FILE_PATH" == *"/.github/"* ]]; then
    NEEDS_PROTECTION=true
fi

# 2. 代码文件
EXT="${FILE_PATH##*.}"
case "$EXT" in
    ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|hpp|rb|php|swift|kt|sh)
        NEEDS_PROTECTION=true
        ;;
esac

if [[ "$NEEDS_PROTECTION" == "false" ]]; then
    exit 0
fi

# ===== 以下是需要保护的文件 =====

# 从文件路径找到所属的 git 仓库
FILE_DIR=$(dirname "$FILE_PATH")
if [[ ! -d "$FILE_DIR" ]]; then
    # 文件目录不存在，可能是新文件，向上查找
    FILE_DIR=$(dirname "$FILE_DIR")
fi

# 切换到文件所在目录，获取该仓库的信息
if ! cd "$FILE_DIR" 2>/dev/null; then
    exit 0
fi

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [[ -z "$PROJECT_ROOT" ]]; then
    exit 0  # 不在 git 仓库中
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ -z "$CURRENT_BRANCH" ]]; then
    exit 0
fi

# ===== 分支检查 =====

# feature/* 分支直接放行
if [[ "$CURRENT_BRANCH" =~ ^feature/ ]]; then
    exit 0
fi

# cp-* 分支检查步骤状态
if [[ "$CURRENT_BRANCH" =~ ^cp-[a-zA-Z0-9] ]]; then
    CURRENT_STEP=$(git config --get branch."$CURRENT_BRANCH".step 2>/dev/null || echo "0")

    # 写代码需要 step >= 3 (DoD 完成)
    if [[ "$CURRENT_STEP" -lt 3 ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  ❌ 步骤未完成，不能写代码" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "当前分支: $CURRENT_BRANCH" >&2
        echo "当前步骤: $CURRENT_STEP" >&2
        echo "需要步骤: >= 3 (DoD 完成)" >&2
        echo "" >&2
        echo "步骤说明:" >&2
        echo "  1 = 准备完成" >&2
        echo "  2 = PRD 完成" >&2
        echo "  3 = DoD 完成 ← 需要到这里才能写代码" >&2
        echo "" >&2
        echo "请先运行 /dev 完成前置步骤" >&2
        echo "" >&2
        echo "[SKILL_REQUIRED: dev]" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        exit 2
    fi

    # 步骤检查通过，放行
    exit 0
fi

# 禁止的分支（main, develop, 其他）
echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  ❌ 只能在 cp-* 或 feature/* 分支修改代码" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2
echo "当前分支: $CURRENT_BRANCH" >&2
echo "" >&2
echo "请先运行 /dev 创建 cp-* 分支" >&2
echo "" >&2
echo "[SKILL_REQUIRED: dev]" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
exit 2
