#!/usr/bin/env bash
# ============================================================================
# Stop Hook: 任务完成检查
# ============================================================================
#
# 触发：Claude 要退出/完成任务时
# 作用：验证任务是否真的完成了
#
# 检查项（cp-* 分支）：
#   - step >= 9（已合并）或不在 cp-* 分支
#   - 如果 step < 9，提示还有工作没完成
#
# ============================================================================

set -e

# 读取输入（丢弃，stop hook 不需要）
cat > /dev/null

# 获取项目根目录
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$PROJECT_ROOT"

# 获取当前分支
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# 只检查 cp-* 分支
if [[ ! "$CURRENT_BRANCH" =~ ^cp-[a-zA-Z0-9] ]]; then
    # 不在 cp-* 分支，直接放行
    exit 0
fi

# 获取当前步骤
CURRENT_STEP=$(git config --get branch."$CURRENT_BRANCH".step 2>/dev/null || echo "0")

echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  STOP GATE: 任务完成检查" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2
echo "  分支: $CURRENT_BRANCH" >&2
echo "  步骤: $CURRENT_STEP" >&2
echo "" >&2

# 步骤含义：
# 1-2: PRD/DoD 阶段
# 3-5: 写代码/写测试
# 6: 本地测试通过
# 7: PR 已创建
# 8: CI 通过
# 9: 已合并
# 10: 已清理

if [[ "$CURRENT_STEP" -lt 7 ]]; then
    echo "  ⚠️  还没创建 PR (step=$CURRENT_STEP)" >&2
    echo "" >&2
    echo "  当前进度:" >&2
    case $CURRENT_STEP in
        0|1) echo "    → 准备阶段" >&2 ;;
        2) echo "    → PRD 完成" >&2 ;;
        3) echo "    → DoD 完成，可以写代码" >&2 ;;
        4) echo "    → 代码完成" >&2 ;;
        5) echo "    → 测试完成" >&2 ;;
        6) echo "    → 本地测试通过，可以提 PR" >&2 ;;
    esac
    echo "" >&2
    echo "  建议: 继续完成任务或运行 /dev" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    # 警告但不阻止（step < 7 可能是正常中断）
    exit 0
fi

if [[ "$CURRENT_STEP" -eq 7 ]]; then
    echo "  ⚠️  PR 已创建但还没合并 (step=7)" >&2
    echo "" >&2
    echo "  建议: 等 CI 通过后合并 PR" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    # 警告但不阻止
    exit 0
fi

if [[ "$CURRENT_STEP" -eq 8 ]]; then
    echo "  ⚠️  CI 通过但还没合并 (step=8)" >&2
    echo "" >&2
    echo "  建议: 合并 PR" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    # 警告但不阻止
    exit 0
fi

if [[ "$CURRENT_STEP" -eq 9 ]]; then
    echo "  ✅ PR 已合并 (step=9)" >&2
    echo "" >&2
    echo "  建议: 运行 cleanup 清理分支" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 0
fi

if [[ "$CURRENT_STEP" -ge 10 ]]; then
    echo "  ✅ 任务已完成 (step=$CURRENT_STEP)" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 0
fi

exit 0
