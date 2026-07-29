#!/usr/bin/env bash
# ZenithJoy Engine - 分支保护 Hook v31
# v31: GP锚定闭环刀6 — .dev-mode 必须含合法 gp_anchor 行（三级校验：存在/格式/id），
#      id 校验带中央 product-map fallback + fail-open 保险（宁漏勿锁死，CI lint-gp-anchor 兜底）
# v30: 移除 Engine skills 保护 — skills 已迁至 zenithjoy-skills repo
# v29: 删除状态机门禁 — Hook 只做安全兜底，验证放 CI
# v28: 精简版 — 只留 worktree/分支保护核心逻辑
# v24: 统一分支命名规范 — cp-* 为唯一合法格式
# v21: worktree 检测双重保险 — 保留

set -euo pipefail

# ===== 共享工具函数 =====
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/hook-utils.sh
if ! source "$SCRIPT_DIR/../lib/hook-utils.sh" 2>/dev/null; then
    echo "[ERROR] hook-utils.sh 加载失败: $SCRIPT_DIR/../lib/hook-utils.sh" >&2
    exit 2
fi

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

# ===== .dev-mode 文件放行（不再做状态机验证，验证由 CI 负责）=====
if echo "$FILE_PATH" | grep -qE '(^|/)\.dev-mode(\.[^/]+)?$'; then
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

# 全局 skills 目录：直接放行（skills 已迁至 zenithjoy-skills repo，不再需要保护）
# 全局 skills 放行
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
if [[ -z "${CURRENT_BRANCH}" ]]; then
    echo "[ERROR] 无法获取当前分支名" >&2
    exit 2
fi

# ===== DoD 未勾选条目检测（场景3）=====
# 当 Task Card / DoD 文件被写入时，检测是否存在 [ ] 未勾选项
_check_dod_unchecked() {
    local task_card=""
    for f in "$PROJECT_ROOT"/.task-*.md "$PROJECT_ROOT/task-card.md" "$PROJECT_ROOT/DoD.md"; do
        [[ -f "$f" ]] && task_card="$f" && break
    done
    [[ -z "$task_card" ]] && return 0
    local unchecked
    unchecked=$(grep -c '^- \[ \]' "$task_card" 2>/dev/null || echo 0)
    if [[ "${unchecked}" -gt 0 ]]; then
        echo "[ERROR] DoD 有 ${unchecked} 个未勾选条目（- [ ]），push 前必须全部验证并改为 [x]：" >&2
        grep -n '^- \[ \]' "$task_card" | head -10 >&2
        echo "  请将所有 '- [ ]' 改为 '- [x]' 后重新提交" >&2
        exit 2
    fi
}

# DoD 文件写入时触发检测
if echo "$FILE_PATH" | grep -qE '(task-card|DoD|\.task-[^/]+)\.md$'; then
    _check_dod_unchecked
fi

# ===== 分支检查：cp-* 为唯一合法格式 =====
if [[ "${CURRENT_BRANCH}" =~ ^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$ ]]; then

    # Worktree 检测（双重保险）
    GIT_DIR_PATH=$(git rev-parse --git-dir 2>/dev/null || echo "")
    IS_WORKTREE=false
    if [[ "$GIT_DIR_PATH" == *"worktrees"* ]]; then
        IS_WORKTREE=true
    elif [[ -n "$GIT_DIR_PATH" && -f "${GIT_DIR_PATH}/gitdir" ]]; then
        IS_WORKTREE=true
    fi
    if [[ "$IS_WORKTREE" == false ]]; then
        echo "  必须在独立 worktree 中开发（当前在主仓库 ${CURRENT_BRANCH}）" >&2
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
        REMOTE_BRANCH=$(git ls-remote --heads origin "${CURRENT_BRANCH}" 2>/dev/null || echo "FETCH_FAILED")
        if [[ "$REMOTE_BRANCH" != "FETCH_FAILED" && -n "$REMOTE_BRANCH" ]]; then
            echo "  僵尸 Worktree：分支 ${CURRENT_BRANCH} 已合并到 main" >&2
            echo "[SKILL_REQUIRED: dev]" >&2
            exit 2
        fi
    fi

    # .dev-mode 存在检查（仅支持 per-branch 格式，v14.0.0 已废弃无后缀格式）
    DEV_MODE_FILE="$PROJECT_ROOT/.dev-mode.${CURRENT_BRANCH}"
    if [[ ! -f "$DEV_MODE_FILE" ]]; then
        echo "  没有活跃的 /dev 会话（.dev-mode 缺失），请运行 /dev" >&2
        echo "[SKILL_REQUIRED: dev]" >&2
        exit 2
    fi

    # ===== GP-Anchor 硬校验（v31 — GP锚定闭环刀6，headed 咽喉机械化）=====
    # 与 Brain 派发三变体（executor.js 刀4闸）对齐：无锚，第一行代码都写不出来。
    # 三级校验：①gp_anchor 行存在 ②格式合法（三形态）③推进/keep-green 类 id 真实存在。
    # id 校验 fail-open：product-map 不可得/jq 缺失/解析失败 → 警告放行（CI lint-gp-anchor 兜底）。
    GP_ANCHOR_LINE=$(grep -m1 '^gp_anchor:' "$DEV_MODE_FILE" 2>/dev/null || echo "")
    GP_ANCHOR_VALUE=$(echo "$GP_ANCHOR_LINE" | sed 's/^gp_anchor:[[:space:]]*//' | sed 's/[[:space:]]*$//')

    if [[ -z "$GP_ANCHOR_VALUE" ]]; then
        echo "[ERROR] GP-ANCHOR-MISSING: .dev-mode.${CURRENT_BRANCH} 缺 gp_anchor 行（GP锚定闭环刀6硬闸）" >&2
        echo "  自修复（10秒）：echo 'gp_anchor: <锚>' >> ${DEV_MODE_FILE}" >&2
        echo "  合法三形态：" >&2
        echo "    gp_anchor: line02/customer_smart_acquisition#step7   ← 推进某业务步骤" >&2
        echo "    gp_anchor: line00/gp_anchor_enforcement keep-green   ← 不推进但保持全绿" >&2
        echo "    gp_anchor: none(infra)                               ← 显式豁免(infra|docs|config|backlog)" >&2
        exit 2
    fi

    GP_ANCHOR_FORMAT='^([a-z0-9_]+/[a-z0-9_]+(#step[0-9]+|[[:space:]]+keep-green)|none\((infra|docs|config|backlog)\))$'
    if ! [[ "$GP_ANCHOR_VALUE" =~ $GP_ANCHOR_FORMAT ]]; then
        echo "[ERROR] GP-ANCHOR-FORMAT-INVALID: gp_anchor 值格式非法: '$GP_ANCHOR_VALUE'" >&2
        echo "  合法三形态：<line>/<gp>#stepN | <line>/<gp> keep-green | none(infra|docs|config|backlog)" >&2
        exit 2
    fi

    # none(...) 豁免类 → 无需 id 校验，直接放行
    if [[ "$GP_ANCHOR_VALUE" != none\(* ]]; then
        # 推进/keep-green 类：id 存在性校验（本仓库 map 优先，中央 map fallback，均缺则 fail-open）
        ANCHOR_LINE_ID="${GP_ANCHOR_VALUE%%/*}"
        ANCHOR_REST="${GP_ANCHOR_VALUE#*/}"
        ANCHOR_GP_ID=$(echo "$ANCHOR_REST" | sed 's/#step[0-9]*$//' | sed 's/[[:space:]]*keep-green$//' | sed 's/[[:space:]]*$//')

        LOCAL_MAP="$PROJECT_ROOT/product-map/generated/product-map.json"
        CENTRAL_MAP="${GP_ANCHOR_CENTRAL_MAP:-$HOME/perfect21/zenithjoy/product-map/generated/product-map.json}"
        MAP_FILE=""
        [[ -f "$LOCAL_MAP" ]] && MAP_FILE="$LOCAL_MAP"
        [[ -z "$MAP_FILE" && -f "$CENTRAL_MAP" ]] && MAP_FILE="$CENTRAL_MAP"

        if [[ -z "$MAP_FILE" ]]; then
            echo "[WARN] GP-ANCHOR-MAP-UNAVAILABLE: 本仓库与中央 product-map.json 均不可得，跳过 id 校验（fail-open，CI lint-gp-anchor 兜底）" >&2
        elif ! command -v jq &>/dev/null; then
            echo "[WARN] GP-ANCHOR-JQ-UNAVAILABLE: jq 不可用，跳过 id 校验（fail-open）" >&2
        else
            GP_FOUND=$(jq -r --arg lid "$ANCHOR_LINE_ID" --arg gid "$ANCHOR_GP_ID" \
                '[.golden_paths[]? | select(.line_id == $lid and .id == $gid)] | length' \
                "$MAP_FILE" 2>/dev/null || echo "PARSE_ERROR")
            if [[ "$GP_FOUND" == "PARSE_ERROR" ]]; then
                echo "[WARN] GP-ANCHOR-MAP-PARSE-FAIL: $MAP_FILE 解析失败，跳过 id 校验（fail-open）" >&2
            elif [[ "$GP_FOUND" == "0" ]]; then
                echo "[ERROR] GP-ANCHOR-ID-NOTFOUND: ${ANCHOR_LINE_ID}/${ANCHOR_GP_ID} 在 product-map ( ${MAP_FILE} ) 里查无此锚" >&2
                echo "  现有合法 GP id 清单：" >&2
                jq -r '.golden_paths[]? | "    \(.line_id)/\(.id)"' "$MAP_FILE" 2>/dev/null >&2 || true
                echo "  或改用显式豁免：gp_anchor: none(infra|docs|config|backlog)" >&2
                exit 2
            fi
        fi
    fi

    # 所有检查通过，放行
    exit 0
fi

# 禁止的分支（非 cp-* 分支不允许写代码）
echo "  只能在 cp-MMDDHHNN-task-name 分支修改代码（当前: ${CURRENT_BRANCH}）" >&2
echo "  请先运行 /dev 创建 cp-* 分支" >&2
echo "[SKILL_REQUIRED: dev]" >&2
exit 2
