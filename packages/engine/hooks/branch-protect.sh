#!/usr/bin/env bash
# ZenithJoy Engine - 分支保护 Hook v28
# v28: 精简版 — 只留 worktree/分支保护核心逻辑 + verify-step + Gate seal 防伪
#      PRD/DoD/Learning/版本/数据库检查全部移交 CI
# v26: .dev-mode Step 完成验证（State Machine 强制层）— 保留
# v24: 统一分支命名规范 — cp-* 为唯一合法格式
# v21: worktree 检测双重保险 — 保留

set -euo pipefail

# ===== 共享工具函数 =====
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/hook-utils.sh
source "$SCRIPT_DIR/../lib/hook-utils.sh"

# ===== jq 检查 =====
if ! command -v jq &>/dev/null; then
    echo "[ERROR] jq 未安装，分支保护无法工作" >&2
    exit 2
fi

# ===== JSON 输入处理 =====
INPUT=$(cat)
if ! echo "$INPUT" | jq empty >/dev/null 2>&1; then
    echo "[ERROR] 无效的 JSON 输入" >&2
    exit 2
fi

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // .operation // ""' 2>/dev/null || echo "")
if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
    exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .file_path // ""' 2>/dev/null || echo "")
if [[ -z "$FILE_PATH" ]]; then
    exit 0
fi

# ===== .dev-mode Step 完成验证（State Machine 强制层）v26 =====
if echo "$FILE_PATH" | grep -qE '(^|/)\.dev-mode(\.[^/]+)?$'; then
    _BP_CONTENT=""
    if [[ "$TOOL_NAME" == "Write" ]]; then
        _BP_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // ""' 2>/dev/null || echo "")
    elif [[ "$TOOL_NAME" == "Edit" ]]; then
        _BP_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.new_string // ""' 2>/dev/null || echo "")
    fi

    VERIFY_SCRIPT="$SCRIPT_DIR/verify-step.sh"
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

    if [[ -f "$VERIFY_SCRIPT" && -n "$_BP_CONTENT" ]]; then
        for step_pattern in "step_1_(spec|taskcard):step1" "step_2_code:step2" "step_4_(ship|learning):step4"; do
            pattern="${step_pattern%%:*}"
            step_arg="${step_pattern##*:}"
            if echo "$_BP_CONTENT" | grep -qE "^${pattern}:[[:space:]]+done"; then
                if ! bash "$VERIFY_SCRIPT" "$step_arg" "$CURRENT_BRANCH" "$PROJECT_ROOT" >&2; then
                    exit 2
                fi
            fi
        done
    fi

    # .dev-mode 文件本身放行
    exit 0
fi

# ===== 全局配置目录保护 =====
HOME_DIR="${HOME:-/home/$(whoami)}"
REAL_FILE_PATH="$FILE_PATH"
if [[ "$FILE_PATH" == *".."* ]]; then
    echo "[ERROR] 路径包含 '..' 不允许" >&2
    exit 2
fi
if command -v realpath &>/dev/null; then
    REAL_FILE_PATH=$(realpath -s "$FILE_PATH" 2>/dev/null) || \
    REAL_FILE_PATH=$(realpath "$FILE_PATH" 2>/dev/null) || \
    REAL_FILE_PATH="$FILE_PATH"
fi

# hooks 目录：全部保护
if [[ "$REAL_FILE_PATH" == "$HOME_DIR/.claude/hooks/"* ]] || \
   [[ "$FILE_PATH" == "$HOME_DIR/.claude/hooks/"* ]]; then
    echo "[ERROR] 禁止直接修改全局 hooks 目录" >&2
    exit 2
fi

# skills 目录：只保护 Engine 相关 (dev, qa, audit, semver)
if echo "$REAL_FILE_PATH" | grep -Eq "/.claude/skills/(dev|qa|audit|semver)(/|$)" || \
   echo "$FILE_PATH" | grep -Eq "/.claude/skills/(dev|qa|audit|semver)(/|$)"; then
    echo "[ERROR] 禁止直接修改 Engine 核心 skills" >&2
    exit 2
fi
# 非 Engine 全局 skills 放行
if [[ "$REAL_FILE_PATH" == "$HOME_DIR/.claude/skills/"* ]] || \
   [[ "$FILE_PATH" == "$HOME_DIR/.claude/skills/"* ]]; then
    exit 0
fi

# ===== 判断是否需要保护 =====
NEEDS_PROTECTION=false
if [[ "$FILE_PATH" == *"/skills/"* ]] || \
   [[ "$FILE_PATH" == *"/hooks/"* ]] || \
   [[ "$FILE_PATH" == *"/.github/"* ]]; then
    NEEDS_PROTECTION=true
fi
EXT="${FILE_PATH##*.}"
case "$EXT" in
    ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|hpp|rb|php|swift|kt|sh)
        NEEDS_PROTECTION=true ;;
esac
if [[ "$NEEDS_PROTECTION" == "false" ]]; then
    exit 0
fi

# ===== 获取 git 仓库信息 =====
FILE_DIR=$(dirname "$FILE_PATH")
[[ ! -d "$FILE_DIR" ]] && FILE_DIR=$(dirname "$FILE_DIR")
if ! cd "$FILE_DIR" 2>/dev/null; then
    echo "[ERROR] 无法进入目录: $FILE_DIR" >&2
    exit 2
fi

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [[ -z "$PROJECT_ROOT" ]]; then
    echo "[ERROR] 不在 git 仓库中" >&2
    exit 2
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ -z "$CURRENT_BRANCH" ]]; then
    echo "[ERROR] 无法获取当前分支名" >&2
    exit 2
fi

# ===== 分支检查：cp-* 为唯一合法格式 =====
if [[ "$CURRENT_BRANCH" =~ ^cp-[0-9]{8}-[a-z0-9][a-z0-9_-]*$ ]]; then

    # Worktree 检测（双重保险）
    GIT_DIR_PATH=$(git rev-parse --git-dir 2>/dev/null || echo "")
    IS_WORKTREE=false
    if [[ "$GIT_DIR_PATH" == *"worktrees"* ]]; then
        IS_WORKTREE=true
    elif [[ -n "$GIT_DIR_PATH" && -f "${GIT_DIR_PATH}/gitdir" ]]; then
        IS_WORKTREE=true
    fi
    if [[ "$IS_WORKTREE" == false ]]; then
        echo "  必须在独立 worktree 中开发（当前在主仓库 $CURRENT_BRANCH）" >&2
        echo "[SKILL_REQUIRED: dev]" >&2
        exit 2
    fi

    # 僵尸 Worktree 检测
    COMMITS_AHEAD=0
    if AHEAD_OUTPUT=$(git log "origin/main..${CURRENT_BRANCH}" --oneline 2>/dev/null); then
        COMMITS_AHEAD=$(echo "$AHEAD_OUTPUT" | grep -c . 2>/dev/null || echo 0)
        COMMITS_AHEAD=$(clean_number "$COMMITS_AHEAD")
    fi
    if [[ "$COMMITS_AHEAD" -eq 0 ]]; then
        REMOTE_BRANCH=$(git ls-remote --heads origin "$CURRENT_BRANCH" 2>/dev/null || echo "FETCH_FAILED")
        if [[ "$REMOTE_BRANCH" != "FETCH_FAILED" && -n "$REMOTE_BRANCH" ]]; then
            echo "  僵尸 Worktree：分支 $CURRENT_BRANCH 已合并到 main" >&2
            echo "[SKILL_REQUIRED: dev]" >&2
            exit 2
        fi
    fi

    # .dev-mode 存在检查
    if [[ -f "$PROJECT_ROOT/.dev-mode.${CURRENT_BRANCH}" ]]; then
        DEV_MODE_FILE="$PROJECT_ROOT/.dev-mode.${CURRENT_BRANCH}"
    else
        DEV_MODE_FILE="$PROJECT_ROOT/.dev-mode"
    fi
    if [[ ! -f "$DEV_MODE_FILE" ]]; then
        echo "  没有活跃的 /dev 会话（.dev-mode 缺失），请运行 /dev" >&2
        echo "[SKILL_REQUIRED: dev]" >&2
        exit 2
    fi

    # 所有检查通过，放行
    exit 0
fi

# 禁止的分支（main, develop, 其他）
echo "  只能在 cp-MMDDHHNN-task-name 分支修改代码（当前: $CURRENT_BRANCH）" >&2
echo "  请先运行 /dev 创建 cp-* 分支" >&2
echo "[SKILL_REQUIRED: dev]" >&2
exit 2
