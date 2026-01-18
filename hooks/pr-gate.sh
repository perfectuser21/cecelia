#!/bin/bash
# ============================================================================
# PreToolUse Hook: PR Gate（本地质检门）
# ============================================================================
#
# 触发：拦截 gh pr create
# 作用：提交 PR 前检查流程完成情况 + 跑 DoD 检查
#
# 检查项：
#   Part 1 - 流程检查：
#     - .project-info.json 存在（项目已检测）
#     - step >= 6（本地测试通过）
#
#   Part 2 - DoD 检查：
#     - typecheck, lint, format, test, build, shell
#
# ============================================================================

set -e

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# 只处理 Bash 工具
if [[ "$TOOL_NAME" != "Bash" ]]; then
    exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# 只拦截 gh pr create
if [[ "$COMMAND" != *"gh pr create"* ]]; then
    exit 0
fi

# 获取项目根目录
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

cd "$PROJECT_ROOT"

echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  PR GATE: 流程 + 质检" >&2
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

# 2. 检查分支步骤
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "$CURRENT_BRANCH" =~ ^cp-[a-zA-Z0-9] ]]; then
    echo -n "  分支步骤... " >&2
    CHECKED=$((CHECKED + 1))
    CURRENT_STEP=$(git config --get branch."$CURRENT_BRANCH".step 2>/dev/null || echo "0")
    if [[ "$CURRENT_STEP" -ge 6 ]]; then
        echo "✅ (step=$CURRENT_STEP)" >&2
    else
        echo "❌ (step=$CURRENT_STEP, 需要>=6)" >&2
        echo "    → 请先完成本地测试 (Step 6)" >&2
        FAILED=1
    fi
fi

echo "" >&2
echo "  [质检]" >&2

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
SHELL_FILES=$(find "$PROJECT_ROOT" -name "*.sh" -type f -not -path "*/node_modules/*" 2>/dev/null)
if [[ -n "$SHELL_FILES" ]]; then
    echo -n "  Shell syntax... " >&2
    CHECKED=$((CHECKED + 1))
    SHELL_FAILED=0
    while IFS= read -r f; do
        if ! bash -n "$f" 2>/dev/null; then
            SHELL_FAILED=1
        fi
    done <<< "$SHELL_FILES"
    if [[ $SHELL_FAILED -eq 0 ]]; then
        echo "✅" >&2
    else
        echo "❌" >&2
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
    echo "  请先修复问题再提交。" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  ✅ 质检通过 ($CHECKED 项)，允许提交 PR" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

exit 0
