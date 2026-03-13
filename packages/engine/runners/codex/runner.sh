#!/usr/bin/env bash
# ============================================================================
# Codex Runner — Codex CLI Provider 适配器 v2.0.0
# ============================================================================
# 这是 Codex（OpenAI）Provider 的协议适配器。
# 完成判断逻辑来自 lib/devloop-check.sh（Provider-Agnostic SSOT）。
#
# 此文件职责：
#   1. 初始化 .dev-mode.<branch> 状态文件（Codex 无 session，用 task_id 代替）
#   2. 构建完整的单次执行 prompt（含完整 /dev 工作流指令）
#   3. 调用 codex-bin exec 执行完整工作流
#   4. 若 Codex 中途退出：以带上下文的恢复 prompt 重启（最多 MAX_RETRIES 次）
#   5. 循环调用 devloop_check() 直到完成
#
# 设计原则（v2.0.0 修复）：
#   - 每次 codex-bin exec 都携带完整指令（对齐 Claude Code 持久 session 模式）
#   - 第一次：完整 /dev 工作流 prompt（含 task-id、分支名、项目路径）
#   - 重试：带当前状态+未完成原因的恢复 prompt
#   - 修复兼容性：--sandbox danger-full-access（非 full-access）
#   - 修复兼容性：不用 --cwd（改为 cd 到项目目录后执行）
#   - 支持 CODEX_HOME 环境变量
#
# 使用方式:
#   bash runner.sh --branch cp-03131205-xxx --task-id abc-123 [--dry-run]
#
# 环境变量:
#   CODEX_BIN          — codex-bin 路径（默认 /opt/homebrew/bin/codex-bin）
#   CODEX_HOME         — Codex 配置目录（默认 ~/.codex）
#   CODEX_MAX_RETRIES  — 最大重试次数（默认 10）
#   CECELIA_HEADLESS   — 设为 true 表示无头模式（自动设置）
#
# 版本: v2.0.0
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
CODEX_MAX_RETRIES="${CODEX_MAX_RETRIES:-10}"
export CECELIA_HEADLESS=true
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

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
    cp "$DEV_MODE_FILE" "$DEV_LOCK_FILE"
    echo "✅ 初始化 .dev-mode 和 .dev-lock for branch: $BRANCH"
fi

# ===== 构建完整 /dev 工作流 prompt（第一次调用）=====
build_comprehensive_prompt() {
    local branch="$1"
    local task_id="$2"
    local skill="$3"
    local project_root="$4"

    local task_arg=""
    [[ -n "$task_id" ]] && task_arg=" --task-id $task_id"

    cat << PROMPT
你是 Cecelia 开发代理，请执行完整的 /$skill 工作流，直到 PR 合并为止。

任务信息:
- Task ID: ${task_id:-N/A}
- 目标分支: $branch
- 项目根目录: $project_root
- 工作目录: $project_root

执行完整 /$skill 工作流（必须完成所有步骤才能停止）:

/$skill${task_arg}

重要规则:
1. 必须从头执行到 PR 合并才能停止，不允许中途退出
2. 遇到任何问题自动修复，不要询问用户
3. 所有命令在 $project_root 目录下执行
4. git 操作使用 origin 远端，分支名为 $branch
PROMPT
}

# ===== 构建恢复 prompt（重试调用）=====
build_resume_prompt() {
    local branch="$1"
    local task_id="$2"
    local skill="$3"
    local project_root="$4"
    local current_reason="$5"
    local current_action="$6"
    local retry_num="$7"

    local task_arg=""
    [[ -n "$task_id" ]] && task_arg=" --task-id $task_id"

    cat << PROMPT
你是 Cecelia 开发代理，正在恢复上一次中断的 /$skill 工作流（第 $retry_num 次恢复）。

当前状态: $current_reason
需要执行: $current_action

任务信息:
- Task ID: ${task_id:-N/A}
- 目标分支: $branch
- 项目根目录: $project_root

请从当前状态继续，直到 PR 合并为止:

/$skill${task_arg}

重要规则:
1. 不要重复已完成的步骤，直接从当前状态继续
2. 必须完成到 PR 合并才能停止
3. 遇到问题自动修复，不要询问用户
4. 所有命令在 $project_root 目录下执行
5. 当前未完成原因: $current_reason
PROMPT
}

# ===== 主循环 =====
echo "🚀 Codex Runner v2.0.0 启动"
echo "   分支: $BRANCH"
echo "   Task: ${TASK_ID:-（无）}"
echo "   Skill: $SKILL"
echo "   MaxRetries: $CODEX_MAX_RETRIES"
echo "   ProjectRoot: $PROJECT_ROOT"
echo "   CODEX_HOME: $CODEX_HOME"
echo "   DryRun: $DRY_RUN"
echo ""

RETRY_COUNT=0

while true; do
    RETRY_COUNT=$((RETRY_COUNT + 1))

    if [[ $RETRY_COUNT -gt $CODEX_MAX_RETRIES ]]; then
        echo "❌ 超过最大重试次数 ($CODEX_MAX_RETRIES)，任务失败" >&2

        if [[ -n "$TASK_ID" ]]; then
            curl -s -X PATCH "http://localhost:5221/api/brain/tasks/${TASK_ID}" \
                -H "Content-Type: application/json" \
                -d "{\"status\":\"failed\",\"error\":\"Codex runner 超过最大重试次数 $CODEX_MAX_RETRIES\"}" \
                --max-time 5 2>/dev/null || true
        fi

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

    DEVLOOP_REASON=$(echo "$DEVLOOP_RESULT" | jq -r '.reason // ""' 2>/dev/null || echo "")
    DEVLOOP_ACTION=$(echo "$DEVLOOP_RESULT" | jq -r '.action // ""' 2>/dev/null || echo "")

    echo "  状态: blocked"
    echo "  原因: $DEVLOOP_REASON"
    [[ -n "$DEVLOOP_ACTION" ]] && echo "  行动: $DEVLOOP_ACTION"
    echo ""

    # ===== 构建 prompt =====
    if [[ $RETRY_COUNT -eq 1 ]]; then
        # 第一次：完整工作流 prompt（包含完整 /dev 指令）
        CODEX_PROMPT="$(build_comprehensive_prompt "$BRANCH" "$TASK_ID" "$SKILL" "$PROJECT_ROOT")"
        echo "  [第一次调用：发送完整工作流 prompt]"
    else
        # 重试：带完整上下文的恢复 prompt
        CODEX_PROMPT="$(build_resume_prompt "$BRANCH" "$TASK_ID" "$SKILL" "$PROJECT_ROOT" \
            "$DEVLOOP_REASON" "$DEVLOOP_ACTION" "$RETRY_COUNT")"
        echo "  [第 $RETRY_COUNT 次恢复：发送带上下文的恢复 prompt]"
    fi

    # ===== 调用 codex-bin =====
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] prompt（前 5 行）:"
        echo "$CODEX_PROMPT" | head -5
        echo "  ..."
        echo "  [DRY-RUN] 模拟完成，退出循环"
        break
    fi

    echo "  执行 codex-bin exec (sandbox: danger-full-access)..."
    # 修复: 不用 --cwd（codex-bin 不支持此参数）
    # 修复: --sandbox danger-full-access（full-access 是无效值）
    # 修复: cd 到项目目录后执行，确保工作目录正确
    if ! (cd "$PROJECT_ROOT" && "$CODEX_BIN" exec \
        --sandbox danger-full-access \
        "$CODEX_PROMPT" 2>&1); then
        echo "  ⚠️  codex-bin exec 返回非零，继续检查完成条件..." >&2
    fi

    echo ""
    echo "  轮次 $RETRY_COUNT 完成，检查完成条件..."
    sleep 5
done

echo "✅ Codex Runner 完成（dry-run）"
