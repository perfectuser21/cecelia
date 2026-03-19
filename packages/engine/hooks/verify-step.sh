#!/usr/bin/env bash
# ============================================================================
# verify-step.sh — /dev 步骤完成验证（State Machine 强制层）v1.0.0
# ============================================================================
# 由 branch-protect.sh 在 AI 向 .dev-mode 写入 step_N: done 时调用。
# 验证 AI 自报的步骤完成情况是否有真实证据支撑。
#
# 用法：
#   bash verify-step.sh step1 [BRANCH] [PROJECT_ROOT]
#   bash verify-step.sh step2 [BRANCH] [PROJECT_ROOT]
#   bash verify-step.sh step4 [BRANCH] [PROJECT_ROOT]
#
# 返回值：
#   0 = 验证通过
#   1 = 验证失败（具体错误输出到 stderr）
#
# 版本: v1.0.0
# 创建: 2026-03-18
# ============================================================================

set -euo pipefail

STEP="${1:-}"
BRANCH="${2:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")}"
PROJECT_ROOT="${3:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

if [[ -z "$STEP" ]]; then
    echo "用法: verify-step.sh <step1|step2|step4> [BRANCH] [PROJECT_ROOT]" >&2
    exit 1
fi

# ============================================================================
# 执行日志记录器（source）
# ============================================================================
_EXEC_LOGGER="$PROJECT_ROOT/packages/engine/lib/execution-logger.sh"
if [[ -f "$_EXEC_LOGGER" ]]; then
    source "$_EXEC_LOGGER"
fi

# ============================================================================
# 工具函数
# ============================================================================

_fail() {
    # 记录执行日志
    if command -v _devlog_event &>/dev/null; then
        _devlog_event "verify-step" "$STEP" "fail" "$1"
    fi
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  ❌ [STATE MACHINE] Step 验证失败" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "$1" >&2
    echo "" >&2
    exit 1
}

_pass() {
    # 记录执行日志
    if command -v _devlog_event &>/dev/null; then
        _devlog_event "verify-step" "$STEP" "pass" "$1"
    fi
    echo "  ✅ [STATE MACHINE] $1 验证通过" >&2
    # 写入验签到 .dev-seal.${BRANCH}（供 Stop Hook 三层兜底检查）
    if [[ -n "${PROJECT_ROOT:-}" && -n "${BRANCH:-}" ]]; then
        local _seal_file="$PROJECT_ROOT/.dev-seal.${BRANCH}"
        local _ts
        _ts=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
        echo "${STEP}_seal: verified@${_ts}" >> "$_seal_file" 2>/dev/null || true
        echo "  🔏 验签已写入: ${STEP}_seal → .dev-seal.${BRANCH}" >&2
    fi
}

# ============================================================================
# Step 1 验证：Task Card DoD Test 字段无假命令
# ============================================================================
verify_step1() {
    local task_card=""

    if [[ -n "$BRANCH" ]]; then
        task_card="$PROJECT_ROOT/.task-${BRANCH}.md"
    fi

    if [[ -z "$task_card" || ! -f "$task_card" ]]; then
        task_card=$(find "$PROJECT_ROOT" -maxdepth 1 -name ".task-cp-*.md" 2>/dev/null | head -1 || echo "")
    fi

    if [[ -z "$task_card" || ! -f "$task_card" ]]; then
        _fail "找不到 Task Card 文件（.task-${BRANCH}.md）
  请先完成 Step 1 Task Card，再标记 step_1_taskcard: done"
    fi

    local test_lines
    test_lines=$(grep -E '^\s+Test:' "$task_card" 2>/dev/null || echo "")

    if [[ -z "$test_lines" ]]; then
        _fail "Task Card 中没有找到任何 Test: 字段
  文件: $task_card
  每个 DoD 条目必须有对应的 Test: 命令（不能是 TODO）"
    fi

    if echo "$test_lines" | grep -qE "Test:[[:space:]]*TODO" 2>/dev/null; then
        _fail "Task Card 存在 Test: TODO 未填写
  文件: $task_card
  Step 1 完成前必须填写所有 Test: 命令"
    fi

    # 检查假命令模式
    local found_fake
    found_fake=$(echo "$test_lines" | grep -E 'Test:\s*(manual:)?(echo |ls( |$)|cat |test -f|true$|exit 0)' 2>/dev/null || echo "")

    if [[ -n "$found_fake" ]]; then
        _fail "Task Card 包含假 Test 命令（不验证真实行为）：
$found_fake
  禁止的假命令：echo / ls / cat / test -f / true / exit 0
  正确示例：
    Test: manual:node -e \"const c=require('fs').readFileSync('file','utf8');if(!c.includes('X'))process.exit(1)\"
    Test: tests/my.test.ts
    Test: contract:my-behavior"
    fi

    # Gate 1: CI 镜像 — check-dod-mapping.cjs（与 CI L1 完全相同的检查）
    local _dod_check="$PROJECT_ROOT/packages/engine/scripts/devgate/check-dod-mapping.cjs"
    if [[ -f "$_dod_check" ]]; then
        echo "  🔍 [Gate 1] 运行 CI 镜像检查（check-dod-mapping.cjs）..." >&2
        if ! node "$_dod_check" >/dev/null 2>&1; then
            _fail "Gate 1 失败：DoD 映射检查不通过（与 CI L1 相同检查）
  运行以下命令查看详情：
    node packages/engine/scripts/devgate/check-dod-mapping.cjs
  Gate 1 过 = CI L1 必过。请修复后重新执行 Step 1。"
        fi
        echo "  ✅ [Gate 1] DoD 映射检查通过" >&2
    fi

    # Gate 2: Agent Seal 检查 — step_1_agent: approved
    if [[ -n "$BRANCH" ]]; then
        local _agent_seal="$PROJECT_ROOT/.dev-agent-seal.${BRANCH}"
        if ! grep -q "step_1_agent: approved" "$_agent_seal" 2>/dev/null; then
            _fail "Gate 2 未通过：缺少 step_1_agent: approved
  文件: .dev-agent-seal.${BRANCH}
  Gate 2 需要 Subagent 语义审查后写入 agent_seal。
  写入命令：
    echo \"step_1_agent: approved@\$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S%z)\" >> .dev-agent-seal.${BRANCH}"
        fi
        echo "  ✅ [Gate 2] agent_seal 已验证（step_1_agent: approved）" >&2
    fi

    _pass "Step 1 Task Card（Gate 1 CI 镜像 + Gate 2 agent_seal 双通过）"
}

# ============================================================================
# Step 2 验证：代码已写，有实现文件改动
# ============================================================================
verify_step2() {
    local base_branch="main"
    if git rev-parse --verify develop &>/dev/null 2>&1; then
        base_branch="develop"
    fi

    local changed_files=""
    changed_files=$(git diff --name-only "origin/${base_branch}...HEAD" 2>/dev/null || \
                    git diff --name-only "${base_branch}...HEAD" 2>/dev/null || \
                    git diff --name-only HEAD~1 2>/dev/null || echo "")

    if [[ -z "$changed_files" ]]; then
        _fail "当前分支没有任何代码改动
  分支: $BRANCH
  Step 2 完成前必须有实际的代码提交"
    fi

    # 排除纯文档/配置文件，检查是否有实现代码改动
    local impl_files
    impl_files=$(echo "$changed_files" | grep -vE '^docs/|^\.prd|^\.dod|^\.task|^\.dev-mode|^\.history/' 2>/dev/null || echo "")

    if [[ -z "$impl_files" ]]; then
        _fail "当前分支只有文档/配置改动，没有实现代码
  分支: $BRANCH
  Step 2 完成前必须有实际的实现文件改动（.js/.ts/.sh/.cjs 等）"
    fi

    # 检查是否有测试文件（仅警告）
    local test_files
    test_files=$(echo "$changed_files" | grep -E '\.(test|spec)\.(ts|js|mjs|cjs|tsx|jsx)$|/__tests__/' 2>/dev/null || echo "")

    if [[ -z "$test_files" ]]; then
        echo "  ⚠️  [STATE MACHINE] 警告：分支没有测试文件改动" >&2
        echo "     Shell 脚本/Engine 配置任务可继续" >&2
        echo "     功能代码任务应先补充测试" >&2
    fi

    # Gate 1: CI 镜像 — packages/engine npm test（与 CI L4 完全相同）
    local _engine_dir="$PROJECT_ROOT/packages/engine"
    if [[ -d "$_engine_dir" ]]; then
        echo "  🔍 [Gate 1] 运行 CI 镜像检查（packages/engine npm test）..." >&2
        if ! (cd "$_engine_dir" && npm test 2>&1 >&2); then
            _fail "Gate 1 失败：Engine 测试不通过（与 CI L4 相同检查）
  运行以下命令查看详情：
    cd packages/engine && npm test
  Gate 1 过 = CI L4 必过。请修复测试后重新执行 Step 2。"
        fi
        echo "  ✅ [Gate 1] Engine 测试通过" >&2
    fi

    # Gate 2: Agent Seal 检查 — step_2_agent: approved
    if [[ -n "$BRANCH" ]]; then
        local _agent_seal="$PROJECT_ROOT/.dev-agent-seal.${BRANCH}"
        if ! grep -q "step_2_agent: approved" "$_agent_seal" 2>/dev/null; then
            _fail "Gate 2 未通过：缺少 step_2_agent: approved
  文件: .dev-agent-seal.${BRANCH}
  Gate 2 需要 Subagent 语义审查代码质量后写入 agent_seal。
  写入命令：
    echo \"step_2_agent: approved@\$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S%z)\" >> .dev-agent-seal.${BRANCH}"
        fi
        echo "  ✅ [Gate 2] agent_seal 已验证（step_2_agent: approved）" >&2
    fi

    _pass "Step 2 代码改动验证（Gate 1 CI 镜像 + Gate 2 agent_seal 双通过）"
}

# ============================================================================
# Step 4 验证：Learning 文件有必需章节
# ============================================================================
verify_step4() {
    local learning_dir="$PROJECT_ROOT/docs/learnings"
    local learning_file=""

    if [[ -n "$BRANCH" ]]; then
        learning_file="$learning_dir/${BRANCH}.md"
    fi

    if [[ -z "$learning_file" || ! -f "$learning_file" ]]; then
        if [[ -n "$BRANCH" ]]; then
            local branch_prefix
            branch_prefix=$(echo "$BRANCH" | cut -c1-30)
            learning_file=$(find "$learning_dir" -name "cp-*.md" 2>/dev/null | grep "$branch_prefix" | head -1 || echo "")
        fi
    fi

    if [[ -z "$learning_file" || ! -f "$learning_file" ]]; then
        _fail "找不到 Learning 文件
  期望路径: docs/learnings/${BRANCH}.md
  Step 4 完成前必须创建 Learning 文件

  文件必须包含：
    ### 根本原因
    ### 下次预防
    - [ ] 预防措施"
    fi

    local content
    content=$(cat "$learning_file" 2>/dev/null || echo "")

    local errors=""
    if ! echo "$content" | grep -qE '^#{2,3}[[:space:]]+根本原因'; then
        errors="${errors}
  ❌ 缺少 '### 根本原因' 章节"
    fi
    if ! echo "$content" | grep -qE '^#{2,3}[[:space:]]+下次预防'; then
        errors="${errors}
  ❌ 缺少 '### 下次预防' 章节"
    fi

    if [[ -n "$errors" ]]; then
        _fail "Learning 文件格式不完整：
  文件: $learning_file
$errors"
    fi

    if ! echo "$content" | grep -qE '^\s*-\s*\[[ x]\]'; then
        _fail "Learning 文件的 '### 下次预防' 缺少 checklist（- [ ] 格式）
  文件: $learning_file"
    fi

    # Gate 2: Agent Seal 检查 — step_4_agent: approved
    if [[ -n "$BRANCH" ]]; then
        local _agent_seal="$PROJECT_ROOT/.dev-agent-seal.${BRANCH}"
        if ! grep -q "step_4_agent: approved" "$_agent_seal" 2>/dev/null; then
            _fail "Gate 2 未通过：缺少 step_4_agent: approved
  文件: .dev-agent-seal.${BRANCH}
  Gate 2 需要 Subagent 语义审查 Learning 内容后写入 agent_seal。
  写入命令：
    echo \"step_4_agent: approved@\$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S%z)\" >> .dev-agent-seal.${BRANCH}"
        fi
        echo "  ✅ [Gate 2] agent_seal 已验证（step_4_agent: approved）" >&2
    fi

    _pass "Step 4 Learning 文件（格式完整 + Gate 2 agent_seal 通过）"
}

# ============================================================================
# 主入口
# ============================================================================
case "$STEP" in
    step1) verify_step1 ;;
    step2) verify_step2 ;;
    step4) verify_step4 ;;
    *)
        echo "未知的步骤: ${STEP}（支持: step1, step2, step4）" >&2
        exit 1
        ;;
esac
