#!/usr/bin/env bash
# ZenithJoy Engine - 分支保护 Hook v19
# v19: 支持 monorepo 子目录的 PRD/DoD 文件（如 apps/core/.prd.md）
# v18: 放宽 skills 目录保护，只保护 Engine 相关 skills (dev, qa, audit, semver)
# v17: 支持分支级别 PRD/DoD 文件 (.prd-{branch}.md, .dod-{branch}.md)
# 保护：代码文件 + 重要目录（skills/, hooks/, .github/）+ 全局配置目录（部分）

set -euo pipefail

# ===== 共享工具函数 =====
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/hook-utils.sh
source "$SCRIPT_DIR/../lib/hook-utils.sh"

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
# v18: hooks 全部保护，skills 只保护 Engine 相关的 (dev, qa, audit, semver)
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

# hooks 目录：全部保护
if [[ "$REAL_FILE_PATH" == "$HOME_DIR/.claude/hooks/"* ]] || \
   [[ "$FILE_PATH" == "$HOME_DIR/.claude/hooks/"* ]]; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [ERROR] 禁止直接修改全局 hooks 目录" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "文件: $FILE_PATH" >&2
    echo "" >&2
    echo "请在 zenithjoy-engine 仓库修改后部署到全局：" >&2
    echo "  1. 克隆/进入 zenithjoy-engine 仓库" >&2
    echo "  2. 走 /dev 工作流修改 hooks/" >&2
    echo "  3. PR 合并后运行 deploy.sh" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2
fi

# skills 目录：只保护 Engine 相关的 skills (dev, qa, audit, semver)
# P1-6 修复：使用 grep -Eq 强锚点匹配，修复 bash regex 分组问题
is_protected_engine_skill() {
    local path="$1"
    # 锚点匹配：.claude/skills/(dev|qa|audit|semver) 后面必须是 / 或结尾
    echo "$path" | grep -Eq "/.claude/skills/(dev|qa|audit|semver)(/|$)"
}

if is_protected_engine_skill "$REAL_FILE_PATH" || is_protected_engine_skill "$FILE_PATH"; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [ERROR] 禁止直接修改 Engine 核心 skills" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "文件: $FILE_PATH" >&2
    echo "受保护的 skills: dev, qa, audit, semver" >&2
    echo "" >&2
    echo "请在 zenithjoy-engine 仓库修改后部署到全局：" >&2
    echo "  1. 克隆/进入 zenithjoy-engine 仓库" >&2
    echo "  2. 走 /dev 工作流修改 skills/" >&2
    echo "  3. PR 合并后运行 deploy.sh" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2
fi
# 其他 skills (如 script-manager, credentials 等) 不受保护，可从任何 repo 部署
# v18: 非 Engine 的全局 skills 直接放行
if [[ "$REAL_FILE_PATH" == "$HOME_DIR/.claude/skills/"* ]] || \
   [[ "$FILE_PATH" == "$HOME_DIR/.claude/skills/"* ]]; then
    # 已经检查过 Engine skills 并阻止了，到这里说明是非 Engine skill，放行
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

    # v19: Monorepo 支持 - 从文件所在目录向上查找 PRD/DoD 目录
    # 优先级: 子目录 PRD/DoD > 根目录 PRD/DoD
    find_prd_dod_dir() {
        local file_path="$1"
        local project_root="$2"
        local branch="$3"
        local current_dir
        current_dir=$(dirname "$file_path")

        # 处理文件路径（可能不存在）
        if [[ ! -d "$current_dir" ]]; then
            current_dir=$(dirname "$current_dir")
        fi

        while [[ "$current_dir" != "$project_root" && "$current_dir" != "/" && "$current_dir" != "." ]]; do
            # 检查当前目录是否有 PRD/DoD 文件（新格式或旧格式）
            if [[ -f "$current_dir/.prd-${branch}.md" ]] || [[ -f "$current_dir/.prd.md" ]]; then
                echo "$current_dir"
                return 0
            fi
            current_dir=$(dirname "$current_dir")
        done

        # 没找到则返回项目根目录
        echo "$project_root"
    }

    PRD_DOD_DIR=$(find_prd_dod_dir "$FILE_PATH" "$PROJECT_ROOT" "$CURRENT_BRANCH")

    # v17: 分支级别 PRD/DoD 文件（优先新格式，fallback 旧格式）
    PRD_FILE_NEW="$PRD_DOD_DIR/.prd-${CURRENT_BRANCH}.md"
    PRD_FILE_OLD="$PRD_DOD_DIR/.prd.md"
    DOD_FILE_NEW="$PRD_DOD_DIR/.dod-${CURRENT_BRANCH}.md"
    DOD_FILE_OLD="$PRD_DOD_DIR/.dod.md"

    # 选择 PRD 文件（优先新格式）
    if [[ -f "$PRD_FILE_NEW" ]]; then
        PRD_FILE="$PRD_FILE_NEW"
        PRD_BASENAME=".prd-${CURRENT_BRANCH}.md"
    elif [[ -f "$PRD_FILE_OLD" ]]; then
        PRD_FILE="$PRD_FILE_OLD"
        PRD_BASENAME=".prd.md"
    else
        PRD_FILE=""
        PRD_BASENAME=".prd-${CURRENT_BRANCH}.md"  # 新分支应使用新格式
    fi

    # 选择 DoD 文件（优先新格式）
    if [[ -f "$DOD_FILE_NEW" ]]; then
        DOD_FILE="$DOD_FILE_NEW"
        DOD_BASENAME=".dod-${CURRENT_BRANCH}.md"
    elif [[ -f "$DOD_FILE_OLD" ]]; then
        DOD_FILE="$DOD_FILE_OLD"
        DOD_BASENAME=".dod.md"
    else
        DOD_FILE=""
        DOD_BASENAME=".dod-${CURRENT_BRANCH}.md"  # 新分支应使用新格式
    fi

    # 检查 PRD 文件是否存在
    if [[ -z "$PRD_FILE" || ! -f "$PRD_FILE" ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [ERROR] 缺少 PRD 文件 ($PRD_BASENAME)" >&2
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
    PRD_LINES=$(clean_number "$(wc -l < "$PRD_FILE" 2>/dev/null)")
    PRD_HAS_CONTENT=$(clean_number "$(grep -cE '(功能描述|成功标准|需求来源|描述|标准)' "$PRD_FILE" 2>/dev/null || echo 0)")

    if [[ "$PRD_LINES" -lt 3 || "$PRD_HAS_CONTENT" -eq 0 ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [ERROR] PRD 文件内容无效 ($PRD_BASENAME)" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "当前分支: $CURRENT_BRANCH" >&2
        echo "PRD 需要至少 3 行，且包含关键字段（功能描述/成功标准）" >&2
        echo "" >&2
        echo "[SKILL_REQUIRED: dev]" >&2
        exit 2
    fi

    # 检查 DoD 文件是否存在
    if [[ -z "$DOD_FILE" || ! -f "$DOD_FILE" ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [ERROR] 缺少 DoD 文件 ($DOD_BASENAME)" >&2
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
    DOD_LINES=$(clean_number "$(wc -l < "$DOD_FILE" 2>/dev/null)")
    DOD_HAS_CHECKBOX=$(clean_number "$(grep -cE '^\s*-\s*\[[ xX]\]' "$DOD_FILE" 2>/dev/null || echo 0)")

    if [[ "$DOD_LINES" -lt 3 || "$DOD_HAS_CHECKBOX" -eq 0 ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [ERROR] DoD 文件内容无效 ($DOD_BASENAME)" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "当前分支: $CURRENT_BRANCH" >&2
        echo "DoD 需要至少 3 行，且包含验收清单 (- [ ] 格式)" >&2
        echo "" >&2
        echo "[SKILL_REQUIRED: dev]" >&2
        exit 2
    fi

    # 检查 PRD 是否为当前分支更新的（防止复用旧的）
    BASE_BRANCH=$(git config "branch.$CURRENT_BRANCH.base-branch" 2>/dev/null || echo "")
    # v18: 自动检测 base 分支（develop 优先，fallback 到 main）
    if [[ -z "$BASE_BRANCH" ]] || ! git rev-parse "$BASE_BRANCH" >/dev/null 2>&1; then
        if git rev-parse develop >/dev/null 2>&1; then
            BASE_BRANCH="develop"
        elif git rev-parse main >/dev/null 2>&1; then
            BASE_BRANCH="main"
        else
            # Bug #2 修复: 安全 fallback，处理新仓库（<10 commits）
            COMMIT_COUNT=$(git rev-list --count HEAD 2>/dev/null || echo "0")
            if [[ $COMMIT_COUNT -gt 10 ]]; then
                BASE_BRANCH="HEAD~10"
            elif [[ $COMMIT_COUNT -gt 0 ]]; then
                # 使用第一个 commit 作为 base
                BASE_BRANCH=$(git rev-list --max-parents=0 HEAD 2>/dev/null || echo "HEAD")
            else
                BASE_BRANCH="HEAD"  # 空仓库，使用当前 HEAD
            fi
        fi
    fi

    # Bug fix: TOCTOU 缓解 - 立即解析 BASE_BRANCH 为 commit SHA
    # 这样即使分支在检测后被删除或移动，后续的 git log 仍能正确引用
    BASE_REF=$(git rev-parse "$BASE_BRANCH" 2>/dev/null || echo "")
    if [[ -z "$BASE_REF" ]]; then
        # BASE_BRANCH 无法解析，使用 HEAD 作为 fallback（会导致 PRD 检查失败，但不会崩溃）
        BASE_REF="HEAD"
    fi

    # v19: 检查 PRD/DoD 是否 gitignored（gitignored 文件无法通过 git 跟踪，跳过更新检查）
    PRD_GITIGNORED=0
    if git check-ignore -q "$PRD_FILE" 2>/dev/null; then
        PRD_GITIGNORED=1
    fi

    # v17: 检查新旧两种格式的 PRD 文件（仅对非 gitignored 文件有效）
    # Bug fix: 使用 grep -F (fixed string) 避免 regex 注入风险
    # 如果分支名包含 [、] 等特殊字符，-E 模式会错误解析
    if [[ "$PRD_GITIGNORED" -eq 0 ]]; then
        PRD_IN_BRANCH=$(clean_number "$(git log "$BASE_REF"..HEAD --name-only 2>/dev/null | grep -cF "$PRD_BASENAME" || echo 0)")
        PRD_STAGED=$(clean_number "$(git diff --cached --name-only 2>/dev/null | grep -cF "$PRD_BASENAME" || echo 0)")
        PRD_MODIFIED=$(clean_number "$(git diff --name-only 2>/dev/null | grep -cF "$PRD_BASENAME" || echo 0)")
        PRD_UNTRACKED=$(clean_number "$(git status --porcelain 2>/dev/null | grep -cF "$PRD_BASENAME" || echo 0)")

        if [[ "$PRD_IN_BRANCH" -eq 0 && "$PRD_STAGED" -eq 0 && "$PRD_MODIFIED" -eq 0 && "$PRD_UNTRACKED" -eq 0 ]]; then
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "  [ERROR] PRD 文件未更新 ($PRD_BASENAME)" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "" >&2
            echo "当前分支: $CURRENT_BRANCH" >&2
            echo "当前 PRD 是旧任务的，请为本次任务更新 PRD" >&2
            echo "" >&2
            echo "[SKILL_REQUIRED: dev]" >&2
            exit 2
        fi
    fi
    # gitignored PRD 文件只需存在且内容有效（前面已检查），跳过更新检查

    # v19: 检查 DoD 是否 gitignored
    DOD_GITIGNORED=0
    if git check-ignore -q "$DOD_FILE" 2>/dev/null; then
        DOD_GITIGNORED=1
    fi

    # v17: 检查新旧两种格式的 DoD 文件（仅对非 gitignored 文件有效）
    # Bug fix: 使用 grep -F (fixed string) 避免 regex 注入风险
    if [[ "$DOD_GITIGNORED" -eq 0 ]]; then
        DOD_IN_BRANCH=$(clean_number "$(git log "$BASE_REF"..HEAD --name-only 2>/dev/null | grep -cF "$DOD_BASENAME" || echo 0)")
        DOD_STAGED=$(clean_number "$(git diff --cached --name-only 2>/dev/null | grep -cF "$DOD_BASENAME" || echo 0)")
        DOD_MODIFIED=$(clean_number "$(git diff --name-only 2>/dev/null | grep -cF "$DOD_BASENAME" || echo 0)")
        DOD_UNTRACKED=$(clean_number "$(git status --porcelain 2>/dev/null | grep -cF "$DOD_BASENAME" || echo 0)")

        if [[ "$DOD_IN_BRANCH" -eq 0 && "$DOD_STAGED" -eq 0 && "$DOD_MODIFIED" -eq 0 && "$DOD_UNTRACKED" -eq 0 ]]; then
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "  [ERROR] DoD 文件未更新 ($DOD_BASENAME)" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "" >&2
            echo "当前分支: $CURRENT_BRANCH" >&2
            echo "当前 DoD 是旧任务的，请为本次任务更新 DoD" >&2
            echo "" >&2
            echo "[SKILL_REQUIRED: dev]" >&2
            exit 2
        fi
    fi
    # gitignored DoD 文件只需存在且内容有效（前面已检查），跳过更新检查

    # v18: 检查 Task Checkpoint 是否已创建
    DEV_MODE_FILE="$PROJECT_ROOT/.dev-mode"
    if [[ -f "$DEV_MODE_FILE" ]]; then
        # Bug #6 修复: 检查 Step 3 状态，如果正在执行则允许通过
        # Bug fix: 增加 Step 3 超时检查（防止卡在 in_progress 绕过检查）
        STEP_3_STATUS=$(grep "^step_3_branch:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "pending")
        STEP_3_TIME=$(grep "^step_3_time:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "0")
        CURRENT_TIME=$(date +%s)

        if [[ "$STEP_3_STATUS" == "in_progress" ]]; then
            # 检查是否超时（10 分钟 = 600 秒）
            if [[ "$STEP_3_TIME" -gt 0 ]] && [[ $((CURRENT_TIME - STEP_3_TIME)) -gt 600 ]]; then
                echo "" >&2
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
                echo "  [ERROR] Step 3 超时（卡在 in_progress 超过 10 分钟）" >&2
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
                echo "" >&2
                echo "可能原因: 上次 /dev 执行中断" >&2
                echo "请删除 .dev-mode 并重新运行 /dev" >&2
                echo "" >&2
                echo "[SKILL_REQUIRED: dev]" >&2
                exit 2
            fi
            # Step 3 正在执行，允许通过
            exit 0
        fi

        if [[ "$STEP_3_STATUS" == "done" ]]; then
            # Step 3 已完成，允许通过
            exit 0
        fi

        # 否则检查 tasks_created
        # Bug fix: 使用 awk 替代 cut，避免多空格边界问题
        TASKS_CREATED=$(grep "^tasks_created:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "")
        if [[ "$TASKS_CREATED" != "true" ]]; then
            echo "" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "  [ERROR] Task Checkpoint 未创建" >&2
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
            echo "" >&2
            echo "当前分支: $CURRENT_BRANCH" >&2
            echo ".dev-mode 缺少 tasks_created: true" >&2
            echo "" >&2
            echo "请在 /dev Step 3 创建所有 Task 后再写代码" >&2
            echo "" >&2
            echo "[SKILL_REQUIRED: dev]" >&2
            exit 2
        fi
    fi

    # PRD, DoD, Tasks 都存在且已更新，放行
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
