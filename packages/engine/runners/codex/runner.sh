#!/usr/bin/env bash
# ============================================================================
# Codex Runner — Codex CLI Provider 适配器 v2.3.0
# ============================================================================
# 这是 Codex（OpenAI）Provider 的协议适配器。
# 完成判断逻辑来自 lib/devloop-check.sh（Provider-Agnostic SSOT）。
#
# 此文件职责：
#   1. 初始化 .dev-mode.<branch> 状态文件（Codex 无 session，用 task_id 代替）
#   2. 从 Brain API（US 侧）预拉 PRD 内容，嵌入 prompt（v2.2.0 新增）
#   3. 构建完整的单次执行 prompt（含完整 /dev 工作流指令 + PRD 内容）
#   4. 调用 codex-bin exec 执行完整工作流
#   5. 若 Codex 中途退出：以带上下文的恢复 prompt 重启（最多 MAX_RETRIES 次）
#   6. 循环调用 devloop_check() 直到完成
#   7. Quota 超限时自动切换账号（v2.3.0 新增）
#
# 设计原则（v2.3.0 新增账号轮换）：
#   - CODEX_HOMES 支持冒号分隔的多个 CODEX_HOME 路径
#   - 若某轮输出含 "Quota exceeded"，自动切换下一个账号继续（不计入重试次数）
#   - 所有账号耗尽才真正失败
#   - 未设置 CODEX_HOMES 时，降级使用单一 CODEX_HOME（向后兼容）
#
# 设计原则（v2.2.0 修复）：
#   - PRD 内容在 US 侧预拉，嵌入 prompt（避免 Codex 在 M4 调 localhost:5221）
#   - BRAIN_API_URL 可配置（US 本地默认 http://localhost:5221，M4 需设置远程地址）
#   - 每次 codex-bin exec 都携带完整指令（对齐 Claude Code 持久 session 模式）
#   - 第一次：完整 /dev 工作流 prompt（含 PRD 内容、分支名、项目路径）
#   - 重试：带当前状态+未完成原因的恢复 prompt（含 PRD 内容）
#   - 修复兼容性：--sandbox danger-full-access（非 full-access）
#   - 修复兼容性：不用 --cwd（改为 cd 到项目目录后执行）
#
# 使用方式:
#   bash runner.sh --branch cp-03131205-xxx --task-id abc-123 [--dry-run]
#
# 环境变量:
#   CODEX_BIN          — codex-bin 路径（默认 /opt/homebrew/bin/codex-bin）
#   CODEX_HOMES        — 冒号分隔的多账号路径（v2.3.0，优先于 CODEX_HOME）
#                        例: /home/user/.codex-team1:/home/user/.codex-team2
#   CODEX_HOME         — 单账号配置目录（CODEX_HOMES 未设置时使用，默认 ~/.codex）
#   CODEX_API_KEY      — OpenAI API Key（自动从 ~/.credentials/openai.env 加载）
#   CODEX_MAX_RETRIES  — 最大重试次数（默认 10，账号切换不计入）
#   CECELIA_HEADLESS   — 设为 true 表示无头模式（自动设置）
#   BRAIN_API_URL      — Brain API 地址（默认 http://localhost:5221，M4 需设置远程）
#
# 版本: v2.3.0
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
BRAIN_API_URL="${BRAIN_API_URL:-http://localhost:5221}"
export CECELIA_HEADLESS=true

# ===== 账号列表初始化（v2.3.0）=====
# CODEX_HOMES 优先：冒号分隔的多账号路径
# 未设置时降级到单一 CODEX_HOME（向后兼容）
CODEX_ACCOUNT_LIST=()
if [[ -n "${CODEX_HOMES:-}" ]]; then
    IFS=':' read -ra CODEX_ACCOUNT_LIST <<< "$CODEX_HOMES"
    echo "🔑 多账号模式：${#CODEX_ACCOUNT_LIST[@]} 个账号"
    for i in "${!CODEX_ACCOUNT_LIST[@]}"; do
        echo "   账号 $((i+1)): ${CODEX_ACCOUNT_LIST[$i]}"
    done
else
    CODEX_ACCOUNT_LIST=("${CODEX_HOME:-$HOME/.codex}")
    echo "🔑 单账号模式（向后兼容）: ${CODEX_ACCOUNT_LIST[0]}"
fi

# 当前账号索引（从 0 开始）
CURRENT_ACCOUNT_IDX=0
export CODEX_HOME="${CODEX_ACCOUNT_LIST[0]}"

# ===== 加载 API Key（v2.1.0）=====
# codex-bin v0.114.0 使用 CODEX_API_KEY（优先于 OPENAI_API_KEY）
# 若环境中已有则直接使用，否则从 credentials 文件加载
if [[ -z "${CODEX_API_KEY:-}" ]]; then
    CREDENTIALS_FILE="$HOME/.credentials/openai.env"
    if [[ -f "$CREDENTIALS_FILE" ]]; then
        # 从 credentials 文件提取 OPENAI_API_KEY 的值
        _raw_key=$(grep -E '^OPENAI_API_KEY=' "$CREDENTIALS_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]')
        if [[ -n "$_raw_key" ]]; then
            export CODEX_API_KEY="$_raw_key"
            echo "✅ 从 $CREDENTIALS_FILE 加载 CODEX_API_KEY"
        else
            echo "⚠️  $CREDENTIALS_FILE 中未找到 OPENAI_API_KEY" >&2
        fi
        unset _raw_key
    else
        echo "⚠️  未找到 credentials 文件: $CREDENTIALS_FILE" >&2
        echo "   请设置 CODEX_API_KEY 环境变量或创建 $CREDENTIALS_FILE" >&2
    fi
else
    echo "✅ 使用已有的 CODEX_API_KEY 环境变量"
fi

# ===== 预拉 PRD 内容（v2.2.0）=====
# 在 US 侧（有 Brain）预拉 PRD，避免 Codex 在 M4 侧尝试访问 localhost:5221
PRD_TITLE=""
PRD_CONTENT=""

fetch_task_prd() {
    local task_id="$1"
    local api_url="$2"

    if [[ -z "$task_id" ]]; then
        return 0
    fi

    echo "📋 从 Brain 预拉 PRD（task_id: $task_id）..."
    local response
    response=$(curl -s --max-time 10 "${api_url}/api/brain/tasks/${task_id}" 2>/dev/null || echo "")

    if [[ -z "$response" ]]; then
        echo "  ⚠️  Brain API 无响应（${api_url}），将使用 --task-id 方式（需要 Codex 侧有 Brain）" >&2
        return 1
    fi

    local title description
    title=$(echo "$response" | jq -r '.title // ""' 2>/dev/null || echo "")
    description=$(echo "$response" | jq -r '.description // ""' 2>/dev/null || echo "")

    if [[ -z "$description" ]]; then
        echo "  ⚠️  Task ${task_id} 没有 description 字段，无法注入 PRD" >&2
        return 1
    fi

    PRD_TITLE="$title"
    PRD_CONTENT="$description"
    echo "  ✅ PRD 预拉成功（标题: ${title:-（无）}，内容长度: ${#description} 字符）"
    return 0
}

if [[ -n "$TASK_ID" ]]; then
    fetch_task_prd "$TASK_ID" "$BRAIN_API_URL" || true
fi

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
    local prd_title="${5:-}"
    local prd_content="${6:-}"

    # 若已预拉 PRD 内容，直接嵌入 prompt（不再传 --task-id，避免 Codex 调 localhost:5221）
    # 若无 PRD 内容，降级到 --task-id 模式（要求 Codex 侧能访问 Brain）
    local task_arg=""
    local prd_section=""
    if [[ -n "$prd_content" ]]; then
        prd_section="
任务 PRD（已从 Brain 预拉，直接使用，不要再调用 localhost:5221）:
标题: ${prd_title:-（无标题）}

---PRD 开始---
${prd_content}
---PRD 结束---
"
    elif [[ -n "$task_id" ]]; then
        task_arg=" --task-id $task_id"
        prd_section="
注意: PRD 内容无法预拉，Codex 需从 Brain 读取（task_id: $task_id）。
"
    fi

    cat << PROMPT
你是 Cecelia 开发代理，请执行完整的 /$skill 工作流，直到 PR 合并为止。

任务信息:
- Task ID: ${task_id:-N/A}
- 目标分支: $branch
- 项目根目录: $project_root
- 工作目录: $project_root
${prd_section}
执行完整 /$skill 工作流（必须完成所有步骤才能停止）:

/$skill${task_arg}

重要规则:
1. 必须从头执行到 PR 合并才能停止，不允许中途退出
2. 遇到任何问题自动修复，不要询问用户
3. 所有命令在 $project_root 目录下执行
4. git 操作使用 origin 远端，分支名为 $branch
5. 若上方已提供 PRD 内容，直接使用，不要尝试访问 localhost:5221
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
    local prd_title="${8:-}"
    local prd_content="${9:-}"

    local task_arg=""
    local prd_section=""
    if [[ -n "$prd_content" ]]; then
        prd_section="
任务 PRD（已预拉，直接使用）:
标题: ${prd_title:-（无标题）}

---PRD 开始---
${prd_content}
---PRD 结束---
"
    elif [[ -n "$task_id" ]]; then
        task_arg=" --task-id $task_id"
    fi

    cat << PROMPT
你是 Cecelia 开发代理，正在恢复上一次中断的 /$skill 工作流（第 $retry_num 次恢复）。

当前状态: $current_reason
需要执行: $current_action

任务信息:
- Task ID: ${task_id:-N/A}
- 目标分支: $branch
- 项目根目录: $project_root
${prd_section}
请从当前状态继续，直到 PR 合并为止:

/$skill${task_arg}

重要规则:
1. 不要重复已完成的步骤，直接从当前状态继续
2. 必须完成到 PR 合并才能停止
3. 遇到问题自动修复，不要询问用户
4. 所有命令在 $project_root 目录下执行
5. 当前未完成原因: $current_reason
6. 若上方已提供 PRD 内容，直接使用，不要尝试访问 localhost:5221
PROMPT
}

# ===== 账号切换函数（v2.3.0）=====
# 返回 0：切换成功；返回 1：所有账号已耗尽
switch_to_next_account() {
    CURRENT_ACCOUNT_IDX=$((CURRENT_ACCOUNT_IDX + 1))
    if [[ $CURRENT_ACCOUNT_IDX -ge ${#CODEX_ACCOUNT_LIST[@]} ]]; then
        echo "❌ 所有账号（${#CODEX_ACCOUNT_LIST[@]} 个）均已耗尽，任务失败" >&2
        return 1
    fi
    export CODEX_HOME="${CODEX_ACCOUNT_LIST[$CURRENT_ACCOUNT_IDX]}"
    echo "🔄 账号切换：切换到账号 $((CURRENT_ACCOUNT_IDX + 1))/${#CODEX_ACCOUNT_LIST[@]}（$CODEX_HOME）"
    return 0
}

# ===== 主循环 =====
echo "🚀 Codex Runner v2.3.0 启动"
echo "   分支: $BRANCH"
echo "   Task: ${TASK_ID:-（无）}"
echo "   Skill: $SKILL"
echo "   MaxRetries: $CODEX_MAX_RETRIES"
echo "   ProjectRoot: $PROJECT_ROOT"
echo "   账号数: ${#CODEX_ACCOUNT_LIST[@]}"
echo "   当前账号: $CODEX_HOME"
echo "   DryRun: $DRY_RUN"
echo "   BrainAPI: $BRAIN_API_URL"
echo "   PRD 预拉: $([ -n "$PRD_CONTENT" ] && echo "✅ 成功（${#PRD_CONTENT} 字符）" || echo "❌ 未拉取（将降级到 --task-id）")"
echo ""

RETRY_COUNT=0

while true; do
    RETRY_COUNT=$((RETRY_COUNT + 1))

    if [[ $RETRY_COUNT -gt $CODEX_MAX_RETRIES ]]; then
        echo "❌ 超过最大重试次数 ($CODEX_MAX_RETRIES)，任务失败" >&2

        if [[ -n "$TASK_ID" ]]; then
            curl -s -X PATCH "${BRAIN_API_URL}/api/brain/tasks/${TASK_ID}" \
                -H "Content-Type: application/json" \
                -d "{\"status\":\"failed\",\"error\":\"Codex runner 超过最大重试次数 $CODEX_MAX_RETRIES\"}" \
                --max-time 5 2>/dev/null || true
        fi

        rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE"
        exit 1
    fi

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  [Codex Runner: 第 $RETRY_COUNT/$CODEX_MAX_RETRIES 轮 | 账号 $((CURRENT_ACCOUNT_IDX+1))/${#CODEX_ACCOUNT_LIST[@]}]"
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
        # 第一次：完整工作流 prompt（含预拉的 PRD 内容）
        CODEX_PROMPT="$(build_comprehensive_prompt "$BRANCH" "$TASK_ID" "$SKILL" "$PROJECT_ROOT" \
            "$PRD_TITLE" "$PRD_CONTENT")"
        echo "  [第一次调用：发送完整工作流 prompt$([ -n "$PRD_CONTENT" ] && echo "（含预拉 PRD）" || echo "（--task-id 降级模式）")]"
    else
        # 重试：带完整上下文的恢复 prompt（含预拉的 PRD 内容）
        CODEX_PROMPT="$(build_resume_prompt "$BRANCH" "$TASK_ID" "$SKILL" "$PROJECT_ROOT" \
            "$DEVLOOP_REASON" "$DEVLOOP_ACTION" "$RETRY_COUNT" "$PRD_TITLE" "$PRD_CONTENT")"
        echo "  [第 $RETRY_COUNT 次恢复：发送带上下文的恢复 prompt$([ -n "$PRD_CONTENT" ] && echo "（含预拉 PRD）" || echo "")]"
    fi

    # ===== 调用 codex-bin =====
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] prompt（前 5 行）:"
        echo "$CODEX_PROMPT" | head -5
        echo "  ..."
        echo "  [DRY-RUN] 模拟完成，退出循环"
        break
    fi

    echo "  执行 codex-bin exec (sandbox: danger-full-access, CODEX_HOME: $CODEX_HOME)..."
    # 修复: 不用 --cwd（codex-bin 不支持此参数）
    # 修复: --sandbox danger-full-access（full-access 是无效值）
    # 修复: cd 到项目目录后执行，确保工作目录正确
    # v2.3.0: 捕获输出以检测 Quota exceeded 错误
    CODEX_OUTPUT=""
    CODEX_EXIT_CODE=0
    CODEX_OUTPUT=$(cd "$PROJECT_ROOT" && CODEX_HOME="$CODEX_HOME" "$CODEX_BIN" exec \
        --sandbox danger-full-access \
        "$CODEX_PROMPT" 2>&1) || CODEX_EXIT_CODE=$?

    # 输出到 stdout（让日志可见）
    echo "$CODEX_OUTPUT"

    # ===== Quota 检测与账号切换（v2.3.0）=====
    if echo "$CODEX_OUTPUT" | grep -qi "Quota exceeded"; then
        echo ""
        echo "  ⚠️  检测到 Quota exceeded（账号 $((CURRENT_ACCOUNT_IDX+1)): $CODEX_HOME）"
        if switch_to_next_account; then
            echo "  ↩️  本轮不计入重试次数，继续下一轮（使用新账号）"
            RETRY_COUNT=$((RETRY_COUNT - 1))
            sleep 2
            continue
        else
            # 所有账号耗尽
            if [[ -n "$TASK_ID" ]]; then
                curl -s -X PATCH "${BRAIN_API_URL}/api/brain/tasks/${TASK_ID}" \
                    -H "Content-Type: application/json" \
                    -d "{\"status\":\"failed\",\"error\":\"所有 ${#CODEX_ACCOUNT_LIST[@]} 个 Codex 账号均 Quota exceeded\"}" \
                    --max-time 5 2>/dev/null || true
            fi
            rm -f "$DEV_MODE_FILE" "$DEV_LOCK_FILE"
            exit 1
        fi
    fi

    if [[ $CODEX_EXIT_CODE -ne 0 ]]; then
        echo "  ⚠️  codex-bin exec 返回非零 (exit=$CODEX_EXIT_CODE)，继续检查完成条件..." >&2
    fi

    echo ""
    echo "  轮次 $RETRY_COUNT 完成，检查完成条件..."
    sleep 5
done

echo "✅ Codex Runner 完成（dry-run）"
