#!/bin/bash
# ZenithJoy Engine - Bash 命令守卫 Hook
# 功能：
#   1. 步骤状态机守卫 - 拦截 git config step 命令，强制顺序执行
#   2. PR 前检查 - 拦截 gh pr create，强制 test/typecheck

set -e

# 检查 jq 是否存在
if ! command -v jq &>/dev/null; then
  echo "⚠️ jq 未安装，Bash 守卫 Hook 无法正常工作" >&2
  exit 0
fi

# Read JSON input from stdin
INPUT=$(cat)

# Extract command (with error handling)
if ! COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>&1); then
    echo "⚠️ Hook 无法解析输入 JSON: $COMMAND" >&2
    exit 0
fi

# ===== 步骤状态机守卫 =====
# 拦截 git config branch.*.step N 命令
# 支持格式: branch.NAME.step, branch."NAME".step, branch.$VAR.step
# 注意：必须从命令本身解析分支名，不能用 git rev-parse HEAD（并行 subagents 会竞态）
if [[ "$COMMAND" =~ git[[:space:]]+config[[:space:]]+(branch\.[^[:space:]]+\.step)[[:space:]]+(-?[0-9]+) ]]; then
    CONFIG_KEY="${BASH_REMATCH[1]}"  # e.g., "branch.cp-xxx.step" or "branch.\"cp-xxx\".step"
    NEW_STEP="${BASH_REMATCH[2]}"

    # 从 config key 中提取分支名：移除 "branch." 前缀和 ".step" 后缀
    BRANCH_NAME="${CONFIG_KEY#branch.}"
    BRANCH_NAME="${BRANCH_NAME%.step}"
    # 处理带引号的分支名: branch."cp-xxx".step
    BRANCH_NAME="${BRANCH_NAME//\"/}"

    if [[ -z "$BRANCH_NAME" ]]; then
        exit 0  # 无法解析分支名，放行
    fi

    # 获取当前步骤
    CURRENT_STEP=$(git config --get branch."$BRANCH_NAME".step 2>/dev/null || echo "0")

    # ===== 边界检查 =====
    # step 必须在 1-10 范围内
    if [[ "$NEW_STEP" -lt 1 || "$NEW_STEP" -gt 10 ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  ❌ 步骤守卫：无效步骤！" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "尝试设置: $NEW_STEP" >&2
        echo "有效范围: 1-10" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        exit 2
    fi

    # 验证步骤变化
    # 允许：递增 1 或 回退到 4（失败重试，且必须已经到过 step 4+）
    EXPECTED_STEP=$((CURRENT_STEP + 1))

    # 允许回退到 step 4（修复后重试）
    # 条件：目标是 4，且当前步骤 >= 4（说明已经到过 step 4）
    if [[ "$NEW_STEP" -eq 4 && "$CURRENT_STEP" -ge 4 ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  🔄 步骤回退：回到 step 4 重试" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        exit 0
    fi

    # 阻止其他回退（如 4→3, 5→2 等）
    if [[ "$NEW_STEP" -lt "$CURRENT_STEP" ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  ❌ 步骤守卫：不能回退！" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "当前步骤: $CURRENT_STEP" >&2
        echo "尝试设置: $NEW_STEP" >&2
        echo "只允许回退到 step 4（且必须已经到过 step 4）" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        exit 2
    fi

    if [[ "$NEW_STEP" -ne "$EXPECTED_STEP" ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  ❌ 步骤守卫：不能跳步！" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "当前步骤: $CURRENT_STEP" >&2
        echo "尝试设置: $NEW_STEP" >&2
        echo "期望步骤: $EXPECTED_STEP（或回退到 4）" >&2
        echo "" >&2
        echo "正常流程：1→2→3→4→5→6→7→8→9→10" >&2
        echo "失败回退：→4→5→6→7→8（循环）" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        exit 2
    fi

    # 步骤 5→6 验证：npm test 必须通过
    if [[ "$NEW_STEP" -eq 6 ]]; then
        PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")

        if [[ -n "$PROJECT_ROOT" && -f "$PROJECT_ROOT/package.json" ]]; then
            if grep -q '"test"' "$PROJECT_ROOT/package.json"; then
                echo "" >&2
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
                echo "  🔍 步骤守卫：验证测试通过" >&2
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
                echo "" >&2

                cd "$PROJECT_ROOT"
                if ! npm test >/dev/null 2>&1; then
                    echo "  ❌ npm test 失败" >&2
                    echo "     必须测试通过才能进入 step 6" >&2
                    echo "" >&2
                    echo "运行 npm test 查看详情" >&2
                    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
                    exit 2
                fi

                echo "  ✅ npm test 通过" >&2
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
                echo "" >&2
            fi
        fi
    fi

    # 步骤验证通过
    exit 0
fi

# ===== PR 前检查 =====
# 只检查 gh pr create 命令
if [[ "$COMMAND" != *"gh pr create"* ]]; then
    exit 0
fi

# 获取项目根目录（从 git）
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")

if [[ -z "$PROJECT_ROOT" ]]; then
    exit 0
fi

# 检查是否有 package.json
if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
    exit 0
fi

cd "$PROJECT_ROOT"

echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  🔍 PR 前检查 (Pre-PR Hook)" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2

FAILED=0

# 1. 运行 typecheck（如果有这个 script）
if grep -q '"typecheck"' "$PROJECT_ROOT/package.json"; then
    echo "  → npm run typecheck..." >&2
    if ! npm run typecheck >/dev/null 2>&1; then
        echo "  ❌ typecheck 失败" >&2
        echo "     运行: npm run typecheck 查看详情" >&2
        FAILED=1
    else
        echo "  ✅ typecheck 通过" >&2
    fi
fi

# 2. 运行 test（如果有这个 script）
if grep -q '"test"' "$PROJECT_ROOT/package.json"; then
    echo "  → npm test..." >&2
    if ! npm test >/dev/null 2>&1; then
        echo "  ❌ test 失败" >&2
        echo "     运行: npm test 查看详情" >&2
        FAILED=1
    else
        echo "  ✅ test 通过" >&2
    fi
fi

# 3. Claude Code Review（本地运行）
if command -v claude &>/dev/null; then
    echo "" >&2
    echo "  → Claude Code Review..." >&2

    # 获取 diff
    BASE_BRANCH=$(git config --get branch."$(git rev-parse --abbrev-ref HEAD)".base-branch 2>/dev/null || echo "develop")
    DIFF=$(git diff "$BASE_BRANCH"...HEAD 2>/dev/null)

    if [[ -n "$DIFF" ]]; then
        # 用 claude -p 做 review
        REVIEW=$(echo "$DIFF" | claude -p "Review this git diff for:
1. Code quality issues
2. Potential bugs
3. Security concerns

Be very concise. If no major issues, just say 'LGTM'.
Only mention critical issues that MUST be fixed before merge." 2>/dev/null || echo "")

        if [[ -n "$REVIEW" ]]; then
            echo "" >&2
            echo "  📝 Claude Review:" >&2
            echo "$REVIEW" | sed 's/^/     /' >&2
            echo "" >&2

            # 检查是否有严重问题（包含 ❌ 或 "must fix" 等关键词）
            if echo "$REVIEW" | grep -qiE "(critical|must fix|security issue|vulnerability)"; then
                echo "  ⚠️  发现严重问题，建议先修复" >&2
                # 不阻止，只是警告
            fi
        fi
        echo "  ✅ Claude review 完成" >&2
    else
        echo "  ℹ️  无 diff，跳过 review" >&2
    fi
else
    echo "  ℹ️  claude 未安装，跳过 review" >&2
fi

echo "" >&2

if [[ $FAILED -eq 1 ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  ❌ 检查未通过，PR 创建被阻止" >&2
    echo "  请先修复问题再创建 PR" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    exit 2  # 阻止操作
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  ✅ 所有检查通过，允许创建 PR" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2

exit 0
