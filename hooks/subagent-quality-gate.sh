#!/usr/bin/env bash
# ============================================================================
# SubagentStop Hook: 质检报告强制检查
# ============================================================================
#
# 触发：Subagent 完成 Step 5-7 尝试退出时
# 作用：强制检查 .quality-report.json 存在且 overall=pass
#
# 返回值：
#   exit 0 - 允许 subagent 退出
#   exit 2 - 阻止 subagent 退出，继续工作
#
# ============================================================================

set -euo pipefail

# 读取输入
INPUT=$(cat)

# 获取项目根目录
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$PROJECT_ROOT"

# 获取当前分支
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# 只检查 cp-* 分支
if [[ ! "${CURRENT_BRANCH:-}" =~ ^cp-[a-zA-Z0-9] ]]; then
    exit 0  # 不在 cp-* 分支，放行
fi

# 获取当前步骤
CURRENT_STEP=$(git config --get branch."$CURRENT_BRANCH".step 2>/dev/null || echo "0")

# 只在 step=4-6 期间检查（Step 5-7 执行期间）
if [[ "$CURRENT_STEP" -lt 4 || "$CURRENT_STEP" -ge 7 ]]; then
    exit 0  # 不在 Step 5-7 期间，放行
fi

echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  Subagent 质检报告检查" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2

QUALITY_REPORT="$PROJECT_ROOT/.quality-report.json"

# ===== 检查 1: 质检报告必须存在 =====
if [[ ! -f "$QUALITY_REPORT" ]]; then
    echo "  质检报告不存在" >&2
    echo "" >&2
    echo "  请完成以下步骤:" >&2
    echo "    1. 写代码 (Step 5)" >&2
    echo "    2. 写测试 (Step 6)" >&2
    echo "    3. 运行质检 (Step 7)" >&2
    echo "    4. 生成 .quality-report.json" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2  # 阻止退出
fi

# ===== 检查 2: 读取质检报告内容 =====
L1_STATUS=$(jq -r '.layers.L1_automated.status // .layers.L1.status // "unknown"' "$QUALITY_REPORT" 2>/dev/null || echo "unknown")
L2_STATUS=$(jq -r '.layers.L2_verification.status // .layers.L2.status // "unknown"' "$QUALITY_REPORT" 2>/dev/null || echo "unknown")
L3_STATUS=$(jq -r '.layers.L3_acceptance.status // .layers.L3.status // "unknown"' "$QUALITY_REPORT" 2>/dev/null || echo "unknown")
OVERALL=$(jq -r '.overall // .overall_status // "unknown"' "$QUALITY_REPORT" 2>/dev/null || echo "unknown")

echo "  质检结果:" >&2
echo "    L1 (自动化测试): $L1_STATUS" >&2
echo "    L2 (效果验证):   $L2_STATUS" >&2
echo "    L3 (需求验收):   $L3_STATUS" >&2
echo "    Overall:         $OVERALL" >&2
echo "" >&2

# ===== 检查 3: overall 必须是 pass =====
if [[ "$OVERALL" != "pass" ]]; then
    echo "  质检未通过 (overall=$OVERALL)" >&2
    echo "" >&2
    echo "  请修复问题后重新运行质检" >&2
    echo "" >&2

    # 增加 loop 计数
    LOOP_COUNT=$(git config --get branch."$CURRENT_BRANCH".loop_count 2>/dev/null || echo "0")
    LOOP_COUNT=$((LOOP_COUNT + 1))
    git config branch."$CURRENT_BRANCH".loop_count "$LOOP_COUNT"
    echo "  Loop 次数: $LOOP_COUNT" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2  # 阻止退出
fi

# ===== 检查 4: 不能全是 skip =====
if [[ "$L1_STATUS" == "skip" && "$L2_STATUS" == "skip" && "$L3_STATUS" == "skip" ]]; then
    echo "  质检不能全部跳过" >&2
    echo "" >&2
    echo "  至少需要完成一项质检" >&2
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2  # 阻止退出
fi

# ===== 质检通过 =====
echo "  质检通过" >&2
echo "" >&2

# 记录最终 loop 次数
LOOP_COUNT=$(git config --get branch."$CURRENT_BRANCH".loop_count 2>/dev/null || echo "1")
if [[ "$LOOP_COUNT" == "0" ]]; then
    LOOP_COUNT="1"
fi
git config branch."$CURRENT_BRANCH".loop_count "$LOOP_COUNT"
echo "  最终 Loop 次数: $LOOP_COUNT" >&2

# 删除 .subagent-lock 文件
if [[ -f "$PROJECT_ROOT/.subagent-lock" ]]; then
    rm -f "$PROJECT_ROOT/.subagent-lock"
    echo "  已删除 .subagent-lock" >&2
fi

# 设置 step=7（质检通过）
git config branch."$CURRENT_BRANCH".step 7
echo "  已设置 step=7" >&2

echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

exit 0  # 允许退出
