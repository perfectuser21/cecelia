#!/usr/bin/env bash
# ============================================================================
# Playwright Runner — Codex Playwright 自动化适配器 v1.0.0
# ============================================================================
# 职责：
#   1. 从 Brain API 预拉任务描述（目标操作 + 参数）
#   2. 构建 Playwright 探索 prompt（含 CDP 连接地址、脚本保存路径、工作流指令）
#   3. 调用 codex-bin exec 执行探索
#   4. Quota 超限时自动切换账号（复用 codex runner.sh 模式）
#
# 工作流（两阶段）：
#   Phase 1（探索）: Codex + 大模型写 Playwright .cjs，反复测试直到跑通
#   Phase 2（执行）: 直接 node <saved-script>.cjs（本 runner 负责 Phase 1）
#
# 用法:
#   bash playwright-runner.sh --task-id <id> [--dry-run]
#
# 环境变量:
#   CODEX_BIN          — codex-bin 路径（默认 /opt/homebrew/bin/codex-bin）
#   CODEX_HOMES        — 冒号分隔的多账号路径（优先于 CODEX_HOME）
#   CODEX_HOME         — 单账号配置目录（默认 ~/.codex）
#   CODEX_API_KEY      — OpenAI API Key
#   CODEX_MODEL        — Codex 模型（默认 codex-mini-latest）
#   CODEX_MAX_RETRIES  — 最大重试次数（默认 5）
#   BRAIN_API_URL      — Brain API 地址（默认 http://localhost:5221）
#   PC_CDP_URL         — 西安 PC CDP 地址（默认 http://100.97.242.124:19225）
#   SCRIPTS_DIR        — 脚本保存目录（默认 ~/playwright-scripts）
#
# 版本: v1.0.0
# ============================================================================

set -euo pipefail

# ===== 参数解析 =====
TASK_ID=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --task-id) TASK_ID="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        *) echo "未知参数: $1" >&2; exit 1 ;;
    esac
done

if [[ -z "$TASK_ID" ]]; then
    echo "用法: $0 --task-id <id> [--dry-run]" >&2
    echo "  --task-id  Brain Task ID（从 Brain 读取任务描述）" >&2
    echo "  --dry-run  不实际调用 codex-bin，只打印 prompt" >&2
    exit 1
fi

# ===== 配置 =====
CODEX_BIN="${CODEX_BIN:-/opt/homebrew/bin/codex-bin}"
CODEX_MODEL="${CODEX_MODEL:-codex-mini-latest}"
CODEX_MAX_RETRIES="${CODEX_MAX_RETRIES:-5}"
BRAIN_API_URL="${BRAIN_API_URL:-http://localhost:5221}"
PC_CDP_URL="${PC_CDP_URL:-http://100.97.242.124:19225}"
SCRIPTS_DIR="${SCRIPTS_DIR:-$HOME/playwright-scripts}"

# ===== 账号列表初始化 =====
CODEX_ACCOUNT_LIST=()
if [[ -n "${CODEX_HOMES:-}" ]]; then
    IFS=':' read -ra CODEX_ACCOUNT_LIST <<< "$CODEX_HOMES"
    echo "🔑 多账号模式：${#CODEX_ACCOUNT_LIST[@]} 个账号"
else
    CODEX_ACCOUNT_LIST=("${CODEX_HOME:-$HOME/.codex}")
    echo "🔑 单账号模式: ${CODEX_ACCOUNT_LIST[0]}"
fi
CURRENT_ACCOUNT_IDX=0
export CODEX_HOME="${CODEX_ACCOUNT_LIST[0]}"

# ===== 加载 API Key =====
if [[ -z "${CODEX_API_KEY:-}" ]]; then
    CREDENTIALS_FILE="$HOME/.credentials/openai.env"
    if [[ -f "$CREDENTIALS_FILE" ]]; then
        _raw_key=$(grep -E '^OPENAI_API_KEY=' "$CREDENTIALS_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]')
        if [[ -n "$_raw_key" ]]; then
            export CODEX_API_KEY="$_raw_key"
            echo "✅ 从 $CREDENTIALS_FILE 加载 CODEX_API_KEY"
        fi
        unset _raw_key
    fi
fi

# ===== 预拉任务描述 =====
TASK_TITLE=""
TASK_DESC=""

echo "📋 从 Brain 预拉任务（task_id: ${TASK_ID}）..."
response=$(curl -s --max-time 10 "${BRAIN_API_URL}/api/brain/tasks/${TASK_ID}" 2>/dev/null || echo "")
if [[ -n "$response" ]]; then
    TASK_TITLE=$(echo "$response" | jq -r '.title // ""' 2>/dev/null || echo "")
    TASK_DESC=$(echo "$response" | jq -r '.description // ""' 2>/dev/null || echo "")
    echo "  ✅ 任务预拉成功（标题: ${TASK_TITLE:-（无）}）"
else
    echo "  ⚠️  Brain API 无响应，将使用空任务描述" >&2
fi

# ===== 构建 Playwright 探索 prompt =====
build_prompt() {
    local task_id="$1"
    local task_title="$2"
    local task_desc="$3"
    local pc_cdp_url="$4"
    local scripts_dir="$5"

    cat << PROMPT
你是西安 M4 Mac mini 上的 Playwright 自动化工程师。
你的任务是用 Playwright 写一个 Node.js .cjs 脚本，通过 CDP 远程控制西安 PC 的浏览器，完成指定的自动化操作，然后把能跑通的脚本保存下来。

## 任务信息

任务 ID: ${task_id}
任务标题: ${task_title:-（无标题）}

任务描述:
---
${task_desc:-（无描述，请根据任务标题自行判断）}
---

## 环境信息

- 西安 PC CDP 地址: ${pc_cdp_url}
  （Chrome 已在 PC 上以 --remote-debugging-port 启动）
- 脚本保存目录: ${scripts_dir}/
- 脚本格式: CommonJS (.cjs)，使用 'use strict'
- Node.js 可用: /opt/homebrew/bin/node

## 连接方式（必须用这个）

\`\`\`javascript
'use strict';
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.connectOverCDP('${pc_cdp_url}');
  const context = browser.contexts()[0] || await browser.newContext();
  const page = context.pages()[0] || await context.newPage();
  // ... 你的操作
  await browser.close();
}
main().catch(console.error);
\`\`\`

## 工作流程（必须按此执行）

### Phase 1: 检查环境
1. 检查 playwright 是否已安装: node -e "require('playwright')" 2>&1
   - 如果未安装: npm install -g playwright
2. 检查脚本保存目录是否存在: mkdir -p ${scripts_dir}

### Phase 2: 探索目标操作
1. 先写一个最简单的探索脚本（只连接、截图），确认 CDP 连接正常
2. 逐步添加目标操作（点击、输入、等待等）
3. 每次修改后用 node 运行测试
4. 如果报错，分析原因，修改脚本，再测试
5. 重复直到脚本稳定跑通

### Phase 3: 保存脚本
1. 将最终能跑通的脚本保存到: ${scripts_dir}/${task_id}.cjs
2. 在脚本头部加注释说明：任务ID、功能描述、CDP地址、保存时间

### Phase 4: 报告
输出以下信息：
- 脚本路径
- 脚本完成的操作摘要
- 运行命令: node ${scripts_dir}/${task_id}.cjs

## 注意事项

- CDP 连接超时时增加 timeout 参数
- 如果页面元素找不到，先截图看当前状态
- 等待元素用 waitForSelector，不要用固定 sleep
- 脚本必须 .cjs 后缀（CommonJS 格式）
- 绝对不要把凭据硬编码到脚本里

开始执行。
PROMPT
}

PROMPT=$(build_prompt "$TASK_ID" "$TASK_TITLE" "$TASK_DESC" "$PC_CDP_URL" "$SCRIPTS_DIR")

# ===== dry-run 模式 =====
if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    echo "===== [DRY-RUN] 将执行的 Playwright prompt ====="
    echo "$PROMPT"
    echo "================================================"
    echo ""
    echo "✅ dry-run 完成（未实际调用 codex-bin）"
    exit 0
fi

# ===== 检查 codex-bin =====
if [[ ! -x "$CODEX_BIN" ]]; then
    echo "❌ codex-bin 不存在或不可执行: $CODEX_BIN" >&2
    exit 1
fi

# ===== 执行（带账号轮换 + 重试）=====
RETRY_COUNT=0

run_codex() {
    local account_idx="$1"
    export CODEX_HOME="${CODEX_ACCOUNT_LIST[$account_idx]}"
    echo "🚀 调用 Codex（账号 $((account_idx + 1))/${#CODEX_ACCOUNT_LIST[@]}，模型: $CODEX_MODEL）..."

    local output
    output=$("$CODEX_BIN" exec \
        --model "$CODEX_MODEL" \
        --sandbox danger-full-access \
        "$PROMPT" 2>&1) || true

    echo "$output"

    if echo "$output" | grep -qi "quota exceeded\|rate limit"; then
        return 2  # 需要换账号
    fi
    return 0
}

while [[ $RETRY_COUNT -lt $CODEX_MAX_RETRIES ]]; do
    exit_code=0
    run_codex "$CURRENT_ACCOUNT_IDX" || exit_code=$?

    if [[ $exit_code -eq 2 ]]; then
        echo "⚠️  Quota 超限，切换账号..."
        CURRENT_ACCOUNT_IDX=$(( (CURRENT_ACCOUNT_IDX + 1) % ${#CODEX_ACCOUNT_LIST[@]} ))
        if [[ $CURRENT_ACCOUNT_IDX -eq 0 ]]; then
            echo "❌ 所有账号 Quota 超限" >&2
            exit 1
        fi
        continue
    fi

    if [[ $exit_code -eq 0 ]]; then
        echo "✅ Playwright 任务完成"
        exit 0
    fi

    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "⚠️  重试 $RETRY_COUNT/$CODEX_MAX_RETRIES..."
done

echo "❌ 达到最大重试次数（$CODEX_MAX_RETRIES）" >&2
exit 1
