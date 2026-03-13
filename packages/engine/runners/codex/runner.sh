#!/usr/bin/env bash
# ============================================================================
# Codex Runner — Codex CLI Provider 适配器 v1.0.0
# ============================================================================
# 这是 Codex（OpenAI）Provider 的协议适配器。
# 完成判断逻辑来自 lib/devloop-check.sh（Provider-Agnostic SSOT）。
#
# 此文件职责：
#   1. 初始化 .dev-mode.<branch> 状态文件（Codex 无 session，用 task_id 代替）
#   2. 循环调用 devloop_check() 获取完成状态
#   3. 将 action 转换为 codex-bin exec 调用
#   4. 在完成时清理状态文件
#
# 此文件永远不需要修改业务逻辑——只改 lib/devloop-check.sh。
#
# 使用方式:
#   bash runner.sh --branch cp-03131205-xxx --task-id abc-123 [--dry-run]
#
# 环境变量:
#   CODEX_BIN          — codex-bin 路径（默认 /opt/homebrew/bin/codex-bin）
#   CODEX_MAX_RETRIES  — 最大重试次数（默认 30）
#   CECELIA_HEADLESS   — 设为 true 表示无头模式（自动设置）
#
# 版本: v1.0.0
# 创建: 2026-03-13
# ============================================================================

set -euo pipefail

# ===== 参数解析 =====
BRANCH=""
TASK_ID=""
DRY_RUN=false
SKILL="dev"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --branch) BRANCH="$2"; shift 2 ;;
        --task-id) TASK_ID="$2"; shift 2 ;;
        --skill) SKILL="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        *) echo "未知参数: $1" >&2; exit 1 ;;
    esac
done

if [[ -z "$BRANCH" && -z "$TASK_ID" ]]; then
    echo "用法: $0 --branch <branch> [--task-id <id>] [--skill <skill>] [--dry-run]" >&2
    echo "  --branch   功能分支名（如 cp-03131205-xxx-cx）" >&2
    echo "  --task-id  Brain Task ID（用于从 Brain 读取 PRD）" >&2
    echo "  --skill    执行的 Skill（默认 dev）" >&2
    echo "  --dry-run  不实际调用 codex-bin，只打印会执行的命令" >&2
    exit 1
fi

# ===== 配置 =====
CODEX_BIN="${CODEX_BIN:-/opt/homebrew/bin/codex-bin}"
CODEX_MAX_RETRIES="${CODEX_MAX_RETRIES:-30}"
export CECELIA_HEADLESS=true

# ===== 查找 Engine 根目录 =====
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROJECT_ROOT="$(git -C "$ENGINE_ROOT" rev-parse --show-toplevel 2>/dev/null || echo "$ENGINE_ROOT")"

# ===== 加载 devloop-check.sh（SSOT）=====
DEVLOOP_CHECK_LIB=""
for candidate in \
    "$ENGINE_ROOT/lib/devloop-check.sh" \
    "$PROJECT_ROOT/packages/engine/lib/devloop-check.sh" \
    "$HOME/.claude/lib/devloop-check.sh"; do
    if [[ -f "$candidate" ]]; then
        DEVLOOP_CHECK_LIB="$candidate"
        break
    fi
done

if [[ -z "$DEVLOOP_CHECK_LIB" ]]; then
    echo "❌ 找不到 devloop-check.sh，无法运行 Codex runner" >&2
    exit 1
fi

# shellcheck disable=SC1090
source "$DEVLOOP_CHECK_LIB"

# ===== 检查 codex-bin =====
if [[ ! -x "$CODEX_BIN" && "$DRY_RUN" == "false" ]]; then
    echo "❌ codex-bin 不存在或不可执行: $CODEX_BIN" >&2
    echo "  请安装 Codex CLI: brew install codex" >&2
    exit 1
fi

# ===== 初始化状态文件 =====
# Codex 无 Claude Code session，用 CODEX_<task_id> 作为合成 session_id
CODEX_SESSION_ID="CODEX_${TASK_ID:-$(date +%s)}"

DEV_MODE_FILE="$PROJECT_ROOT/.dev-mode.${BRANCH}"
DEV_LOCK_FILE="$PROJECT_ROOT/.dev-lock.${BRANCH}"

if [[ ! -f "$DEV_MODE_FILE" ]]; then
    cat > "$DEV_MODE_FILE" <<EOF
dev
branch: $BRANCH
session_id: $CODEX_SESSION_ID
task_id: ${TASK_ID:-}
provider: codex
started: $(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)
retry_count: 0
EOF
    # 创建 lock 文件（Codex runner 等价于 Claude Code 的 dev-lock）
    cp "$DEV_MODE_FILE" "$DEV_LOCK_FILE"
    echo "✅ 初始化 .dev-mode 和 .dev-lock for branch: $BRANCH"
fi

# ===== 构建初始 prompt =====
build_initial_prompt() {
    local branch="$1"
    local task_id="$2"
    local skill="$3"

    if [[ -n "$task_id" ]]; then
        echo "/$skill --task-id $task_id"
    else
        echo "/$skill"
    fi
}

# ===== 主循环 =====
echo "🚀 Codex Runner 启动"
echo "   分支: $BRANCH"
echo "   Task: ${TASK_ID:-（无）}"
echo "   Skill: $SKILL"
echo "   MaxRetries: $CODEX_MAX_RETRIES"
echo "   DryRun: $DRY_RUN"
echo ""

RETRY_COUNT=0
FIRST_RUN=true

while true; do
    RETRY_COUNT=$((RETRY_COUNT + 1))

    if [[ $RETRY_COUNT -gt $CODEX_MAX_RETRIES ]]; then
        echo "❌ 超过最大重试次数 ($CODEX_MAX_RETRIES)，任务失败" >&2

        # 通知 Brain 失败
        if [[ -n "$TASK_ID" ]]; then
            curl -s -X PATCH "http://localhost:5221/api/brain/tasks/${TASK_ID}" \
                -H "Content-Type: application/json" \
                -d "{\"status\":\"failed\",\"error\":\"Codex runner 超过最大重试次数 $CODEX_MAX_RETRIES\"}" \
                --max-time 5 2>/dev/null || true
        fi

        # 清理状态文件
        rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE"
        exit 1
    fi

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  [Codex Runner: 第 $RETRY_COUNT/$CODEX_MAX_RETRIES 轮]"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # ===== 调用 devloop_check（SSOT）=====
    DEVLOOP_RESULT=$(devloop_check "$BRANCH" "$DEV_MODE_FILE") || true
    DEVLOOP_STATUS=$(echo "$DEVLOOP_RESULT" | jq -r '.status // "blocked"' 2>/dev/null || echo "blocked")

    if [[ "$DEVLOOP_STATUS" == "done" ]]; then
        echo "🎉 工作流完成！清理状态文件..."
        rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE"
        echo "✅ Codex Runner 成功完成"
        exit 0
    fi

    # ===== blocked — 构建 codex prompt =====
    DEVLOOP_REASON=$(echo "$DEVLOOP_RESULT" | jq -r '.reason // ""' 2>/dev/null || echo "")
    DEVLOOP_ACTION=$(echo "$DEVLOOP_RESULT" | jq -r '.action // ""' 2>/dev/null || echo "")

    echo "  状态: blocked"
    echo "  原因: $DEVLOOP_REASON"
    [[ -n "$DEVLOOP_ACTION" ]] && echo "  行动: $DEVLOOP_ACTION"
    echo ""

    # 第一轮：发送完整 /dev skill 启动 prompt
    # 后续轮：发送 reason+action 作为继续 prompt
    if [[ "$FIRST_RUN" == "true" ]]; then
        CODEX_PROMPT="$(build_initial_prompt "$BRANCH" "$TASK_ID" "$SKILL")"
        FIRST_RUN=false
    else
        # 后续轮：将 devloop_check 的 action 作为 codex prompt
        if [[ -n "$DEVLOOP_ACTION" ]]; then
            CODEX_PROMPT="$DEVLOOP_ACTION"
        else
            CODEX_PROMPT="继续执行 /dev 工作流。当前状态：$DEVLOOP_REASON"
        fi
    fi

    echo "  Codex prompt: $CODEX_PROMPT"
    echo ""

    # ===== 调用 codex-bin =====
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] 会执行: $CODEX_BIN exec \"$CODEX_PROMPT\""
        # dry-run 模式下，模拟完成（避免无限循环）
        echo "  [DRY-RUN] 模拟完成，退出循环"
        break
    fi

    echo "  执行 codex-bin exec..."
    # 使用 full-access sandbox 确保可以写文件、运行命令
    if ! "$CODEX_BIN" exec \
        --sandbox full-access \
        --cwd "$PROJECT_ROOT" \
        "$CODEX_PROMPT" 2>&1; then
        echo "  ⚠️  codex-bin exec 返回非零，继续下一轮" >&2
    fi

    echo ""
    echo "  轮次 $RETRY_COUNT 完成，检查完成条件..."
    # 短暂等待让 git push 等操作完成
    sleep 5
done

echo "✅ Codex Runner 完成（dry-run）"
