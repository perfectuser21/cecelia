#!/usr/bin/env bash
# ============================================================================
# PreToolUse Hook: PR Gate v2 (硬门禁版)
# ============================================================================
#
# v8+ 硬门禁规则：
#   PR → develop：必须 L1 全自动绿
#   develop → main：必须 L1 绿 + L2B/L3 证据链齐全
#
# 模式检测：
#   1. 解析 gh pr create --base 参数
#   2. 如果 --base main → release 模式
#   3. 否则 → pr 模式（默认）
#   4. 可用 PR_GATE_MODE=release 强制 release 模式
#
# ============================================================================

set -euo pipefail

INPUT=$(cat)

# 安全提取 tool_name
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

# ===== 模式检测 =====
# 1. 检查环境变量
MODE="${PR_GATE_MODE:-}"

# 2. 解析 --base 参数
if [[ -z "$MODE" ]]; then
    # 提取 --base 参数值
    BASE_BRANCH=$(echo "$COMMAND" | grep -oP '(?<=--base\s)[^\s]+' || echo "")

    if [[ "$BASE_BRANCH" == "main" ]]; then
        MODE="release"
    else
        MODE="pr"
    fi
fi

# 3. 确保 MODE 有效
if [[ "$MODE" != "pr" && "$MODE" != "release" ]]; then
    MODE="pr"
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
if [[ "$MODE" == "release" ]]; then
    echo "  PR GATE: Release 模式 (L1 + L2B + L3)" >&2
else
    echo "  PR GATE: PR 模式 (L1 only)" >&2
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2

FAILED=0
CHECKED=0

# ============================================================================
# Part 0: 基础检查
# ============================================================================
echo "  [基础检查]" >&2

# 检查分支
echo -n "  分支... " >&2
CHECKED=$((CHECKED + 1))
if [[ "${CURRENT_BRANCH:-}" =~ ^(cp-[a-zA-Z0-9]|feature/) ]]; then
    echo "✅ ($CURRENT_BRANCH)" >&2
elif [[ "$MODE" == "release" && "$CURRENT_BRANCH" == "develop" ]]; then
    echo "✅ ($CURRENT_BRANCH → main)" >&2
else
    echo "❌ ($CURRENT_BRANCH)" >&2
    echo "    → PR 模式：必须在 cp-* 或 feature/* 分支" >&2
    echo "    → Release 模式：允许 develop 分支" >&2
    FAILED=1
fi

# ============================================================================
# Part 1: L1 - 自动化测试
# ============================================================================
echo "" >&2
echo "  [L1: 自动化测试]" >&2

# 检测项目类型
HAS_PACKAGE_JSON=false
HAS_PYTHON=false
HAS_GO=false

[[ -f "$PROJECT_ROOT/package.json" ]] && HAS_PACKAGE_JSON=true
[[ -f "$PROJECT_ROOT/requirements.txt" || -f "$PROJECT_ROOT/pyproject.toml" ]] && HAS_PYTHON=true
[[ -f "$PROJECT_ROOT/go.mod" ]] && HAS_GO=true

# Node.js 项目
if [[ "$HAS_PACKAGE_JSON" == "true" ]]; then
    # Typecheck
    if grep -q '"typecheck"' package.json 2>/dev/null; then
        echo -n "  typecheck... " >&2
        CHECKED=$((CHECKED + 1))
        if npm run typecheck >/dev/null 2>&1; then
            echo "✅" >&2
        else
            echo "❌" >&2
            FAILED=1
        fi
    fi

    # Lint
    if grep -q '"lint"' package.json 2>/dev/null; then
        echo -n "  lint... " >&2
        CHECKED=$((CHECKED + 1))
        if npm run lint >/dev/null 2>&1; then
            echo "✅" >&2
        else
            echo "❌" >&2
            FAILED=1
        fi
    fi

    # Test
    if grep -q '"test"' package.json 2>/dev/null; then
        echo -n "  test... " >&2
        CHECKED=$((CHECKED + 1))
        if npm test >/dev/null 2>&1; then
            echo "✅" >&2
        else
            echo "❌" >&2
            FAILED=1
        fi
    fi

    # Build
    if grep -q '"build"' package.json 2>/dev/null; then
        echo -n "  build... " >&2
        CHECKED=$((CHECKED + 1))
        if npm run build >/dev/null 2>&1; then
            echo "✅" >&2
        else
            echo "❌" >&2
            FAILED=1
        fi
    fi
fi

# Python 项目
if [[ "$HAS_PYTHON" == "true" ]]; then
    if [[ -d "$PROJECT_ROOT/tests" || -d "$PROJECT_ROOT/test" || -f "$PROJECT_ROOT/pytest.ini" ]]; then
        echo -n "  pytest... " >&2
        CHECKED=$((CHECKED + 1))
        if pytest -q >/dev/null 2>&1; then
            echo "✅" >&2
        else
            echo "❌" >&2
            FAILED=1
        fi
    fi
fi

# Go 项目
if [[ "$HAS_GO" == "true" ]]; then
    echo -n "  go test... " >&2
    CHECKED=$((CHECKED + 1))
    if go test ./... >/dev/null 2>&1; then
        echo "✅" >&2
    else
        echo "❌" >&2
        FAILED=1
    fi
fi

# Shell 脚本语法检查
SHELL_FAILED=0
SHELL_COUNT=0
SHELL_ERRORS=""
while IFS= read -r -d '' f; do
    SHELL_COUNT=$((SHELL_COUNT + 1))
    ERROR_OUTPUT=$(bash -n "$f" 2>&1) || {
        SHELL_FAILED=1
        SHELL_ERRORS+="    $f: $ERROR_OUTPUT"$'\n'
    }
done < <(find "$PROJECT_ROOT" -name "*.sh" -type f -not -path "*/node_modules/*" -print0 2>/dev/null)

if [[ $SHELL_COUNT -gt 0 ]]; then
    echo -n "  shell syntax... " >&2
    CHECKED=$((CHECKED + 1))
    if [[ $SHELL_FAILED -eq 0 ]]; then
        echo "✅" >&2
    else
        echo "❌" >&2
        if [[ -n "$SHELL_ERRORS" ]]; then
            echo "$SHELL_ERRORS" >&2
        fi
        FAILED=1
    fi
fi

# ============================================================================
# Part 2: PR 模式 - 简化检查
# ============================================================================
if [[ "$MODE" == "pr" ]]; then
    echo "" >&2
    echo "  [DoD 检查] (简化)" >&2

    DOD_FILE="$PROJECT_ROOT/.dod.md"
    echo -n "  DoD 文件... " >&2
    CHECKED=$((CHECKED + 1))
    if [[ -f "$DOD_FILE" ]]; then
        # 检查 .dod.md 是否在当前分支有修改（防止复用旧的 DoD）
        DOD_MODIFIED=$(git diff develop --name-only 2>/dev/null | grep -c "^\.dod\.md$" || echo "0")
        DOD_NEW=$(git status --porcelain 2>/dev/null | grep -c "\.dod\.md" || echo "0")

        if [[ "$DOD_MODIFIED" -gt 0 || "$DOD_NEW" -gt 0 ]]; then
            echo "✅" >&2
        else
            # 检查是否是新分支首次创建（.dod.md 已提交但未推送）
            DOD_IN_BRANCH=$(git log develop..HEAD --name-only 2>/dev/null | grep -c "^\.dod\.md$" || echo "0")
            if [[ "$DOD_IN_BRANCH" -gt 0 ]]; then
                echo "✅ (本分支已提交)" >&2
            else
                echo "❌ (.dod.md 未更新)" >&2
                echo "    → 当前 .dod.md 是旧任务的，请为本次任务更新 DoD" >&2
                FAILED=1
            fi
        fi
    else
        echo "❌ (.dod.md 不存在)" >&2
        echo "    → 请创建 .dod.md 记录 DoD 清单" >&2
        FAILED=1
    fi
fi

# ============================================================================
# Part 3: Release 模式 - L2B + L3 完整检查
# ============================================================================
if [[ "$MODE" == "release" ]]; then
    RELEASE_CHECK="$PROJECT_ROOT/scripts/release-check.sh"

    if [[ -f "$RELEASE_CHECK" ]]; then
        echo "" >&2
        if ! bash "$RELEASE_CHECK" >&2; then
            FAILED=1
        fi
    else
        # 内联检查（兼容没有 release-check.sh 的项目）
        echo "" >&2
        echo "  [L2B: Evidence 校验]" >&2

        L2_EVIDENCE_FILE="$PROJECT_ROOT/.layer2-evidence.md"

        echo -n "  证据文件... " >&2
        CHECKED=$((CHECKED + 1))
        if [[ -f "$L2_EVIDENCE_FILE" ]]; then
            echo "✅" >&2
        else
            echo "❌ (.layer2-evidence.md 不存在)" >&2
            FAILED=1
        fi

        echo "" >&2
        echo "  [L3: Acceptance 校验]" >&2

        DOD_FILE="$PROJECT_ROOT/.dod.md"

        echo -n "  DoD 文件... " >&2
        CHECKED=$((CHECKED + 1))
        if [[ -f "$DOD_FILE" ]]; then
            echo "✅" >&2
        else
            echo "❌ (.dod.md 不存在)" >&2
            FAILED=1
        fi

        if [[ -f "$DOD_FILE" ]]; then
            UNCHECKED=$(grep -c '\- \[ \]' "$DOD_FILE" 2>/dev/null) || true
            CHECKED_BOXES=$(grep -c '\- \[x\]' "$DOD_FILE" 2>/dev/null) || true

            echo -n "  验收项... " >&2
            CHECKED=$((CHECKED + 1))
            if [[ "$UNCHECKED" -eq 0 && "$CHECKED_BOXES" -gt 0 ]]; then
                echo "✅ ($CHECKED_BOXES 项全部完成)" >&2
            else
                echo "❌ ($UNCHECKED 项未完成)" >&2
                FAILED=1
            fi
        fi
    fi
fi

# ============================================================================
# 结果输出
# ============================================================================
echo "" >&2

if [[ $FAILED -eq 1 ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  ❌ PR Gate 检查失败" >&2
    echo "" >&2

    # 回退到 step 4
    if [[ -n "${CURRENT_BRANCH:-}" && "${CURRENT_BRANCH:-}" =~ ^(cp-[a-zA-Z0-9]|feature/) ]]; then
        CURRENT_STEP=$(git config --get branch."$CURRENT_BRANCH".step 2>/dev/null || echo "0")
        if [[ "$CURRENT_STEP" -ge 4 ]]; then
            git config branch."$CURRENT_BRANCH".step 4
            echo "  ⟲ step 回退到 4，请修复后重试" >&2
        else
            echo "  请先运行 /dev 完成前置步骤" >&2
            echo "" >&2
            echo "  [SKILL_REQUIRED: dev]" >&2
        fi
    fi

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
if [[ "$MODE" == "release" ]]; then
    echo "  ✅ Release Gate 通过" >&2
else
    echo "  ✅ PR Gate 通过 ($CHECKED 项)" >&2
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

exit 0
