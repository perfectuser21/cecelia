#!/usr/bin/env bash
# ============================================================================
# PreToolUse Hook: PR Gate（本地质检门）
# ============================================================================
#
# 触发：拦截 gh pr create
# 作用：提交 PR 前检查流程完成情况 + 跑三层质检
#
# 检查项：
#   Part 1 - 流程检查：
#     - .project-info.json 存在（项目已检测）
#     - step >= 7（质检通过）
#
#   Part 2 - 质检报告检查：
#     - .quality-report.json 存在
#     - 包含三层结果（L1_automated, L2_verification, L3_acceptance）
#     - overall 状态为 pass
#
#   Part 3 - 自动化测试（兜底）：
#     - typecheck, lint, format, test, build, shell
#
# ============================================================================

set -euo pipefail

INPUT=$(cat)

# 安全提取 tool_name（避免 jq empty 导致脚本异常退出）
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || echo "")

# 只处理 Bash 工具
if [[ "$TOOL_NAME" != "Bash" ]]; then
    exit 0
fi

# 安全提取 command
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")

# 只拦截 gh pr create
if [[ "$COMMAND" != *"gh pr create"* ]]; then
    exit 0
fi

# 获取项目根目录
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

cd "$PROJECT_ROOT"

echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  PR GATE: 流程 + 三层质检" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2

FAILED=0
CHECKED=0

# ===== Part 1: 流程检查 =====
echo "  [流程检查]" >&2

# 1. 检查 .project-info.json 是否存在
echo -n "  项目检测... " >&2
CHECKED=$((CHECKED + 1))
if [[ -f "$PROJECT_ROOT/.project-info.json" ]]; then
    LEVEL=$(jq -r '.test_levels.max_level // 0' "$PROJECT_ROOT/.project-info.json" 2>/dev/null || echo "0")
    IS_MONO=$(jq -r '.project.is_monorepo // false' "$PROJECT_ROOT/.project-info.json" 2>/dev/null || echo "false")
    if [[ "$IS_MONO" == "true" ]]; then
        echo "✅ (L$LEVEL, Monorepo)" >&2
    else
        echo "✅ (L$LEVEL)" >&2
    fi
else
    echo "❌ (未检测)" >&2
    echo "    → 执行任意 Bash 命令触发自动检测" >&2
    FAILED=1
fi

# 2. 检查分支步骤（cp-* 和 feature/* 都需要检查）
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "${CURRENT_BRANCH:-}" =~ ^(cp-[a-zA-Z0-9]|feature/) ]]; then
    echo -n "  分支步骤... " >&2
    CHECKED=$((CHECKED + 1))
    CURRENT_STEP=$(git config --get branch."$CURRENT_BRANCH".step 2>/dev/null || echo "0")
    if [[ "$CURRENT_STEP" -ge 7 ]]; then
        echo "✅ (step=$CURRENT_STEP)" >&2
    else
        echo "❌ (step=$CURRENT_STEP, 需要>=7)" >&2
        echo "    → 请先完成质检 (Step 7)" >&2
        FAILED=1
    fi
fi

# ===== Part 2: 质检报告检查 =====
echo "" >&2
echo "  [质检报告]" >&2

echo -n "  报告文件... " >&2
CHECKED=$((CHECKED + 1))
if [[ -f "$PROJECT_ROOT/.quality-report.json" ]]; then
    echo "✅" >&2

    # 检查报告的 branch 是否匹配当前分支
    REPORT_BRANCH=$(jq -r '.branch // ""' "$PROJECT_ROOT/.quality-report.json" 2>/dev/null || echo "")
    echo -n "  报告分支... " >&2
    CHECKED=$((CHECKED + 1))
    if [[ "$REPORT_BRANCH" == "$CURRENT_BRANCH" ]]; then
        echo "✅ ($REPORT_BRANCH)" >&2
    else
        echo "❌ (报告: $REPORT_BRANCH, 当前: $CURRENT_BRANCH)" >&2
        echo "    → 这是旧分支的报告，请重新运行质检" >&2
        FAILED=1
    fi

    # 检查三层结果
    L1_STATUS=$(jq -r '.layers.L1_automated.status // "missing"' "$PROJECT_ROOT/.quality-report.json" 2>/dev/null || echo "missing")
    L2_STATUS=$(jq -r '.layers.L2_verification.status // "missing"' "$PROJECT_ROOT/.quality-report.json" 2>/dev/null || echo "missing")
    L3_STATUS=$(jq -r '.layers.L3_acceptance.status // "missing"' "$PROJECT_ROOT/.quality-report.json" 2>/dev/null || echo "missing")
    OVERALL=$(jq -r '.overall // "missing"' "$PROJECT_ROOT/.quality-report.json" 2>/dev/null || echo "missing")

    # 7.1 自动化测试
    echo -n "  7.1 自动化测试... " >&2
    CHECKED=$((CHECKED + 1))
    if [[ "$L1_STATUS" == "pass" ]]; then
        echo "✅" >&2
    elif [[ "$L1_STATUS" == "missing" ]]; then
        echo "❌ (缺失)" >&2
        FAILED=1
    else
        echo "❌ ($L1_STATUS)" >&2
        FAILED=1
    fi

    # 7.2 效果验证
    echo -n "  7.2 效果验证... " >&2
    CHECKED=$((CHECKED + 1))
    if [[ "$L2_STATUS" == "pass" ]]; then
        echo "✅" >&2
    elif [[ "$L2_STATUS" == "missing" ]]; then
        echo "❌ (缺失)" >&2
        FAILED=1
    else
        echo "❌ ($L2_STATUS)" >&2
        FAILED=1
    fi

    # 7.3 需求验收
    echo -n "  7.3 需求验收... " >&2
    CHECKED=$((CHECKED + 1))
    if [[ "$L3_STATUS" == "pass" ]]; then
        echo "✅" >&2
    elif [[ "$L3_STATUS" == "missing" ]]; then
        echo "❌ (缺失)" >&2
        FAILED=1
    else
        echo "❌ ($L3_STATUS)" >&2
        FAILED=1
    fi

    # 总体状态
    echo -n "  总体状态... " >&2
    CHECKED=$((CHECKED + 1))
    if [[ "$OVERALL" == "pass" ]]; then
        echo "✅" >&2
    else
        echo "❌ ($OVERALL)" >&2
        FAILED=1
    fi
else
    echo "❌ (不存在)" >&2
    echo "    → 请先完成三层质检并生成 .quality-report.json" >&2
    FAILED=1
fi

echo "" >&2
echo "  [自动化测试（兜底）]" >&2

# 检测项目类型
HAS_PACKAGE_JSON=false
HAS_PYTHON=false
HAS_GO=false

[[ -f "$PROJECT_ROOT/package.json" ]] && HAS_PACKAGE_JSON=true
[[ -f "$PROJECT_ROOT/requirements.txt" || -f "$PROJECT_ROOT/pyproject.toml" ]] && HAS_PYTHON=true
[[ -f "$PROJECT_ROOT/go.mod" ]] && HAS_GO=true

# ===== Node.js 项目检查 =====
if [[ "$HAS_PACKAGE_JSON" == "true" ]]; then
    # 1. Typecheck
    if grep -q '"typecheck"' package.json; then
        echo -n "  Typecheck... " >&2
        CHECKED=$((CHECKED + 1))
        if npm run typecheck >/dev/null 2>&1; then
            echo "✅" >&2
        else
            echo "❌" >&2
            FAILED=1
        fi
    fi

    # 2. Lint
    if grep -q '"lint"' package.json; then
        echo -n "  Lint... " >&2
        CHECKED=$((CHECKED + 1))
        if npm run lint >/dev/null 2>&1; then
            echo "✅" >&2
        else
            echo "❌" >&2
            FAILED=1
        fi
    fi

    # 3. Format check
    if grep -q '"format:check"' package.json; then
        echo -n "  Format... " >&2
        CHECKED=$((CHECKED + 1))
        if npm run format:check >/dev/null 2>&1; then
            echo "✅" >&2
        else
            echo "❌" >&2
            FAILED=1
        fi
    fi

    # 4. Test
    if grep -q '"test"' package.json; then
        echo -n "  Test... " >&2
        CHECKED=$((CHECKED + 1))
        if npm test >/dev/null 2>&1; then
            echo "✅" >&2
        else
            echo "❌" >&2
            FAILED=1
        fi
    fi

    # 5. Build
    if grep -q '"build"' package.json; then
        echo -n "  Build... " >&2
        CHECKED=$((CHECKED + 1))
        if npm run build >/dev/null 2>&1; then
            echo "✅" >&2
        else
            echo "❌" >&2
            FAILED=1
        fi
    fi
fi

# ===== Python 项目检查 =====
if [[ "$HAS_PYTHON" == "true" ]]; then
    # pytest
    if [[ -d "$PROJECT_ROOT/tests" || -d "$PROJECT_ROOT/test" || -f "$PROJECT_ROOT/pytest.ini" ]]; then
        echo -n "  Pytest... " >&2
        CHECKED=$((CHECKED + 1))
        if pytest -q >/dev/null 2>&1; then
            echo "✅" >&2
        else
            echo "❌" >&2
            FAILED=1
        fi
    fi
fi

# ===== Go 项目检查 =====
if [[ "$HAS_GO" == "true" ]]; then
    echo -n "  Go test... " >&2
    CHECKED=$((CHECKED + 1))
    if go test ./... >/dev/null 2>&1; then
        echo "✅" >&2
    else
        echo "❌" >&2
        FAILED=1
    fi
fi

# ===== Shell 脚本检查（所有项目）=====
# 使用 -print0 和 read -d '' 安全处理含空格的文件名
SHELL_FAILED=0
SHELL_COUNT=0
SHELL_ERRORS=""
while IFS= read -r -d '' f; do
    SHELL_COUNT=$((SHELL_COUNT + 1))
    # 捕获语法错误信息
    ERROR_OUTPUT=$(bash -n "$f" 2>&1) || {
        SHELL_FAILED=1
        SHELL_ERRORS+="    $f: $ERROR_OUTPUT"$'\n'
    }
done < <(find "$PROJECT_ROOT" -name "*.sh" -type f -not -path "*/node_modules/*" -print0 2>/dev/null)

if [[ $SHELL_COUNT -gt 0 ]]; then
    echo -n "  Shell syntax... " >&2
    CHECKED=$((CHECKED + 1))
    if [[ $SHELL_FAILED -eq 0 ]]; then
        echo "✅" >&2
    else
        echo "❌" >&2
        # 显示具体哪些文件有语法错误
        if [[ -n "$SHELL_ERRORS" ]]; then
            echo "$SHELL_ERRORS" >&2
        fi
        FAILED=1
    fi
fi

echo "" >&2

if [[ $CHECKED -eq 0 ]]; then
    echo "  ⚠️  没有检测到可执行的检查项" >&2
    echo "" >&2
fi

if [[ $FAILED -eq 1 ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  ❌ 质检未通过，不能提交 PR" >&2
    echo "" >&2

    # 回退到 step 4（DoD 完成），允许从 Step 5 重新开始
    # 只有 step >= 4 时才回退，否则说明 DoD 还没完成
    # 支持 cp-* 和 feature/* 分支
    if [[ -n "${CURRENT_BRANCH:-}" && "${CURRENT_BRANCH:-}" =~ ^(cp-[a-zA-Z0-9]|feature/) ]]; then
        CURRENT_STEP=$(git config --get branch."$CURRENT_BRANCH".step 2>/dev/null || echo "0")
        if [[ "$CURRENT_STEP" -ge 4 ]]; then
            git config branch."$CURRENT_BRANCH".step 4
            echo "  ⟲ step 回退到 4，从 Step 5 重新循环 5→6→7" >&2
            echo "" >&2
            echo "  请继续：" >&2
            echo "    Step 5: 修复代码" >&2
            echo "    Step 6: 更新测试" >&2
            echo "    Step 7: 跑三层质检" >&2
            echo "    然后再提 PR" >&2
            echo "" >&2
            echo "  注意：DoD 不变，只改代码。" >&2
        else
            echo "  请先运行 /dev 完成 PRD 和 DoD（Step 1-4）" >&2
            echo "" >&2
            echo "  [SKILL_REQUIRED: dev]" >&2
        fi
    fi

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  ✅ 质检通过 ($CHECKED 项)，允许提交 PR" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

exit 0
