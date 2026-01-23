#!/usr/bin/env bash
# ZenithJoy Engine - 分支保护 Hook v16
# 保护：代码文件 + 重要目录（skills/, hooks/, .github/）+ 全局配置目录

set -euo pipefail

# ===== 工具函数 =====

# 清理数值：移除非数字字符，空值默认为 0
clean_number() {
    local val="${1:-0}"
    val="${val//[^0-9]/}"
    echo "${val:-0}"
}

# ===== jq 检查 =====
if ! command -v jq &>/dev/null; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [ERROR] jq 未安装，分支保护无法工作" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "请安装 jq:" >&2
    echo "  Ubuntu/Debian: sudo apt install jq" >&2
    echo "  macOS: brew install jq" >&2
    echo "" >&2
    exit 2
fi

# ===== JSON 输入处理 =====
INPUT=$(cat)

# JSON 预验证，防止格式错误或注入
if ! echo "$INPUT" | jq empty >/dev/null 2>&1; then
    echo "[ERROR] 无效的 JSON 输入" >&2
    exit 2
fi

# 提取 tool_name（安全提取）
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // .operation // ""' 2>/dev/null || echo "")

# 只检查 Write/Edit 操作
if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
    exit 0
fi

# 提取 file_path（安全提取）
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .file_path // ""' 2>/dev/null || echo "")

if [[ -z "$FILE_PATH" ]]; then
    exit 0
fi

# ===== 全局配置目录保护 =====
# 阻止直接修改 ~/.claude/hooks/ 和 ~/.claude/skills/
HOME_DIR="${HOME:-/home/$(whoami)}"
REAL_FILE_PATH="$FILE_PATH"

# 检查路径是否包含危险模式
if [[ "$FILE_PATH" == *".."* ]]; then
    echo "[ERROR] 路径包含 '..' 不允许" >&2
    exit 2
fi

# L2 修复: realpath 兼容性处理（macOS 可能没有 -s 选项）
if command -v realpath &>/dev/null; then
    # 尝试 -s 选项，失败则回退到不带选项
    REAL_FILE_PATH=$(realpath -s "$FILE_PATH" 2>/dev/null) || \
    REAL_FILE_PATH=$(realpath "$FILE_PATH" 2>/dev/null) || \
    REAL_FILE_PATH="$FILE_PATH"
fi

if [[ "$REAL_FILE_PATH" == "$HOME_DIR/.claude/hooks/"* ]] || \
   [[ "$REAL_FILE_PATH" == "$HOME_DIR/.claude/skills/"* ]] || \
   [[ "$FILE_PATH" == "$HOME_DIR/.claude/hooks/"* ]] || \
   [[ "$FILE_PATH" == "$HOME_DIR/.claude/skills/"* ]]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [ERROR] 禁止直接修改全局配置目录" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "文件: $FILE_PATH" >&2
    echo "" >&2
    echo "请在 zenithjoy-engine 修改后部署到全局：" >&2
    echo "  1. cd /home/xx/dev/zenithjoy-engine" >&2
    echo "  2. 走 /dev 工作流修改 hooks/ 或 skills/" >&2
    echo "  3. PR 合并到 main 后部署" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2
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
    FILE_DIR=$(dirname "$FILE_DIR")
fi

# 切换到文件所在目录，获取该仓库的信息
if ! cd "$FILE_DIR" 2>/dev/null; then
    echo "[ERROR] 无法进入目录: $FILE_DIR" >&2
    exit 2
fi

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [[ -z "$PROJECT_ROOT" ]]; then
    # L1 修复: 不在 git 仓库中必须阻止，防止绕过保护
    echo "[ERROR] 不在 git 仓库中，无法验证分支" >&2
    exit 2
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ -z "$CURRENT_BRANCH" ]]; then
    # L1 修复: 无法获取分支必须阻止，防止绕过保护
    echo "[ERROR] 无法获取当前分支名" >&2
    exit 2
fi

# ===== 分支检查 =====

# L1 修复: 统一分支正则标准
# cp-* 要求: cp- 后至少1个字符，允许字母数字、连字符、下划线
# feature/* 要求: feature/ 后至少1个字符，允许字母数字、连字符、下划线、斜杠
if [[ "$CURRENT_BRANCH" =~ ^cp-[a-zA-Z0-9][-a-zA-Z0-9_]*$ ]] || \
   [[ "$CURRENT_BRANCH" =~ ^feature/[a-zA-Z0-9][-a-zA-Z0-9_/]*$ ]]; then

    # 检查 PRD 文件是否存在
    if [[ ! -f "$PROJECT_ROOT/.prd.md" ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [ERROR] 缺少 PRD 文件 (.prd.md)" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "当前分支: $CURRENT_BRANCH" >&2
        echo "请先运行 /dev 创建 PRD" >&2
        echo "" >&2
        echo "[SKILL_REQUIRED: dev]" >&2
        exit 2
    fi

    # 检查 PRD 内容有效性（至少 3 行，且包含关键字段）
    # L2 修复: wc -l 输出可能带空格，使用 clean_number 处理
    PRD_LINES=$(clean_number "$(wc -l < "$PROJECT_ROOT/.prd.md" 2>/dev/null)")
    PRD_HAS_CONTENT=$(clean_number "$(grep -cE '(功能描述|成功标准|需求来源|描述|标准)' "$PROJECT_ROOT/.prd.md" 2>/dev/null || echo 0)")

    if [[ "$PRD_LINES" -lt 3 || "$PRD_HAS_CONTENT" -eq 0 ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [ERROR] PRD 文件内容无效 (.prd.md)" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "当前分支: $CURRENT_BRANCH" >&2
        echo "PRD 需要至少 3 行，且包含关键字段（功能描述/成功标准）" >&2
        echo "" >&2
        echo "[SKILL_REQUIRED: dev]" >&2
        exit 2
    fi

    # 检查 DoD 文件是否存在
    if [[ ! -f "$PROJECT_ROOT/.dod.md" ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [ERROR] 缺少 DoD 文件 (.dod.md)" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "当前分支: $CURRENT_BRANCH" >&2
        echo "请先运行 /dev 创建 DoD" >&2
        echo "" >&2
        echo "[SKILL_REQUIRED: dev]" >&2
        exit 2
    fi

    # 检查 DoD 内容有效性（至少 3 行，且包含验收标准或 checkbox）
    # L2 修复: grep 正则支持大小写 x/X
    DOD_LINES=$(clean_number "$(wc -l < "$PROJECT_ROOT/.dod.md" 2>/dev/null)")
    DOD_HAS_CHECKBOX=$(clean_number "$(grep -cE '^\s*-\s*\[[ xX]\]' "$PROJECT_ROOT/.dod.md" 2>/dev/null || echo 0)")

    if [[ "$DOD_LINES" -lt 3 || "$DOD_HAS_CHECKBOX" -eq 0 ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [ERROR] DoD 文件内容无效 (.dod.md)" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "当前分支: $CURRENT_BRANCH" >&2
        echo "DoD 需要至少 3 行，且包含验收清单 (- [ ] 格式)" >&2
        echo "" >&2
        echo "[SKILL_REQUIRED: dev]" >&2
        exit 2
    fi

    # 检查 PRD 是否为当前分支更新的（防止复用旧的）
    BASE_BRANCH=$(git config "branch.$CURRENT_BRANCH.base-branch" 2>/dev/null || echo "develop")
    # 验证 BASE_BRANCH 存在，否则回退到 develop
    if ! git rev-parse "$BASE_BRANCH" >/dev/null 2>&1; then
        BASE_BRANCH="develop"
    fi

    PRD_IN_BRANCH=$(clean_number "$(git log "$BASE_BRANCH"..HEAD --name-only 2>/dev/null | grep -c '^\.prd\.md$' || echo 0)")
    PRD_STAGED=$(clean_number "$(git diff --cached --name-only 2>/dev/null | grep -c '^\.prd\.md$' || echo 0)")
    PRD_MODIFIED=$(clean_number "$(git diff --name-only 2>/dev/null | grep -c '^\.prd\.md$' || echo 0)")
    PRD_UNTRACKED=$(clean_number "$(git status --porcelain 2>/dev/null | grep -c '^?? \.prd\.md$' || echo 0)")

    if [[ "$PRD_IN_BRANCH" -eq 0 && "$PRD_STAGED" -eq 0 && "$PRD_MODIFIED" -eq 0 && "$PRD_UNTRACKED" -eq 0 ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [ERROR] PRD 文件未更新 (.prd.md)" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "当前分支: $CURRENT_BRANCH" >&2
        echo "当前 .prd.md 是旧任务的，请为本次任务更新 PRD" >&2
        echo "" >&2
        echo "[SKILL_REQUIRED: dev]" >&2
        exit 2
    fi

    # 检查 DoD 是否为当前分支更新的
    DOD_IN_BRANCH=$(clean_number "$(git log "$BASE_BRANCH"..HEAD --name-only 2>/dev/null | grep -c '^\.dod\.md$' || echo 0)")
    DOD_STAGED=$(clean_number "$(git diff --cached --name-only 2>/dev/null | grep -c '^\.dod\.md$' || echo 0)")
    DOD_MODIFIED=$(clean_number "$(git diff --name-only 2>/dev/null | grep -c '^\.dod\.md$' || echo 0)")
    DOD_UNTRACKED=$(clean_number "$(git status --porcelain 2>/dev/null | grep -c '^?? \.dod\.md$' || echo 0)")

    if [[ "$DOD_IN_BRANCH" -eq 0 && "$DOD_STAGED" -eq 0 && "$DOD_MODIFIED" -eq 0 && "$DOD_UNTRACKED" -eq 0 ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [ERROR] DoD 文件未更新 (.dod.md)" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "当前分支: $CURRENT_BRANCH" >&2
        echo "当前 .dod.md 是旧任务的，请为本次任务更新 DoD" >&2
        echo "" >&2
        echo "[SKILL_REQUIRED: dev]" >&2
        exit 2
    fi

    # PRD 和 DoD 都存在且已更新，放行
    exit 0
fi

# 禁止的分支（main, develop, 其他）
echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  [ERROR] 只能在 cp-* 或 feature/* 分支修改代码" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2
echo "当前分支: $CURRENT_BRANCH" >&2
echo "" >&2
echo "请先运行 /dev 创建 cp-* 分支" >&2
echo "" >&2
echo "[SKILL_REQUIRED: dev]" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
exit 2
