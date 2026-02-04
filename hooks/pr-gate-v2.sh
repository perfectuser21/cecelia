#!/usr/bin/env bash
# ============================================================================
# PreToolUse Hook: PR Gate v4.1 (提示型，不阻断)
# ============================================================================
# PR -> develop: L1 全自动绿 + DoD 映射检查 + P0/P1 RCI 检查 + Skill 产物
# develop -> main: L1 绿 + L2B/L3 证据链齐全
# ============================================================================
# v3.1: 添加 timeout 保护，防止测试命令卡住
# v4.0: 快速模式 - 只检查产物，不运行测试（交给 CI + SessionEnd Hook）
# v4.1: 提示型 Gate - 检查失败仅警告，exit 0（不阻断），CI 是唯一门槛
# v4.2: 支持分支级别 PRD/DoD 文件 (.prd-{branch}.md, .dod-{branch}.md)
# v4.3: Gate 验证器硬失败 + 分层 exit code 错误提示
# ============================================================================

set -euo pipefail

# ===== 共享工具函数 =====
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/hook-utils.sh
source "$SCRIPT_DIR/../lib/hook-utils.sh"

# ===== 配置 =====
# 测试命令超时时间（秒）
COMMAND_TIMEOUT="${COMMAND_TIMEOUT:-120}"

# ===== 临时文件管理（v4.3: 修复 trap 覆盖问题）=====
TEMP_FILES=()
cleanup_temp_files() {
  for f in "${TEMP_FILES[@]}"; do
    rm -f "$f" 2>/dev/null || true
  done
}
trap cleanup_temp_files EXIT

# ===== jq 检查 =====
# L1 修复: 添加 jq 可用性检查
if ! command -v jq &>/dev/null; then
    echo "" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [ERROR] jq 未安装，PR Gate 无法工作" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "" >&2
    echo "请安装 jq:" >&2
    echo "  Ubuntu/Debian: sudo apt install jq" >&2
    echo "  macOS: brew install jq" >&2
    echo "" >&2
    exit 2
fi

# ===== JSON 输入处理 =====
INPUT=$(cat)

# JSON 预验证，防止格式错误或注入
if ! echo "$INPUT" | jq empty >/dev/null 2>&1; then
    echo "[ERROR] 无效的 JSON 输入" >&2
    exit 2
fi

# 提取 tool_name
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || echo "")

# 只处理 Bash 工具
if [[ "$TOOL_NAME" != "Bash" ]]; then
    exit 0
fi

# 提取 command
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")

# ===== 硬拦截 --admin 参数 =====
# v4.5: 禁止在 gh pr 命令中使用 --admin 参数绕过分支保护和 CI
# 检测策略：在 gh pr 命令行部分查找 --admin（排除在引号/heredoc 内的文本）
# 通过先移除引号和 heredoc 内容，再检测 --admin
if [[ "$COMMAND" == *"gh pr"* ]]; then
    # 移除所有引号内的内容和 heredoc，只保留命令行参数部分
    # 1. 移除单引号字符串
    # 2. 移除双引号字符串
    # 3. 移除 heredoc (<<'EOF' ... EOF)
    COMMAND_NO_STRINGS=$(echo "$COMMAND" | sed "s/'[^']*'//g" | sed 's/"[^"]*"//g' | sed '/<<.*EOF/,/^EOF/d')

    # 在清理后的命令中检测 --admin
    if [[ "$COMMAND_NO_STRINGS" =~ (^|[[:space:]])--admin([[:space:]]|$) ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [ERROR] 禁止使用 --admin 参数" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "为什么禁止：" >&2
        echo "  --admin 会绕过分支保护和 CI 检查，违反工程规范" >&2
        echo "" >&2
        echo "正确做法：" >&2
        echo "  1. 等待 CI 通过" >&2
        echo "  2. 如果 CI 失败，修复问题后重新提交" >&2
        echo "  3. 如果确实需要合并，请先联系团队讨论" >&2
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        exit 2
    fi
fi

# 拦截所有可能创建 PR 的命令
# 1. gh pr create
# 2. gh api -X POST .../pulls
# 3. curl -X POST .../pulls
# 4. 其他 API 调用方式

IS_PR_CREATION=false

# 检查 gh pr create
if [[ "$COMMAND" == *"gh pr create"* ]]; then
    IS_PR_CREATION=true
fi

# 检查 gh api 创建 PR（repos/.../pulls 或 repos/.../git/refs）
if [[ "$COMMAND" == *"gh api"* ]] && [[ "$COMMAND" == *"/pulls"* ]]; then
    IS_PR_CREATION=true
fi

# 检查 curl 创建 PR
if [[ "$COMMAND" == *"curl"* ]] && [[ "$COMMAND" == *"api.github.com"* ]] && [[ "$COMMAND" == *"/pulls"* ]]; then
    IS_PR_CREATION=true
fi

# 如果不是创建 PR 的命令，放行
if [[ "$IS_PR_CREATION" == "false" ]]; then
    exit 0
fi

# ===== 解析 --repo 参数，找到目标仓库 =====
# L2 修复: 增强参数解析，使用更健壮的正则
TARGET_REPO=""

# 尝试 --repo= 格式
if [[ -z "$TARGET_REPO" && "$COMMAND" =~ --repo=([^[:space:]]+) ]]; then
    TARGET_REPO="${BASH_REMATCH[1]}"
    TARGET_REPO="${TARGET_REPO//[\"\']/}"  # 去除引号
fi

# 尝试 --repo 空格 格式
if [[ -z "$TARGET_REPO" && "$COMMAND" =~ --repo[[:space:]]+([^[:space:]-][^[:space:]]*) ]]; then
    TARGET_REPO="${BASH_REMATCH[1]}"
    TARGET_REPO="${TARGET_REPO//[\"\']/}"
fi

# 尝试 -R 短格式
if [[ -z "$TARGET_REPO" && "$COMMAND" =~ -R[[:space:]]+([^[:space:]-][^[:space:]]*) ]]; then
    TARGET_REPO="${BASH_REMATCH[1]}"
    TARGET_REPO="${TARGET_REPO//[\"\']/}"
fi

PROJECT_ROOT=""

if [[ -n "$TARGET_REPO" ]]; then
    # 有 --repo 参数，尝试找到本地仓库
    # L2 修复: 保留完整的 owner/repo 路径用于搜索
    # 从 URL 提取 owner/repo 或直接使用
    FULL_REPO=$(echo "$TARGET_REPO" | sed 's|.*github\.com[:/]||' | sed 's|\.git$||')
    # 提取 repo 名称（最后一部分）
    REPO_NAME="${FULL_REPO##*/}"

    # 在常见位置搜索仓库
    # v4.4: 使用 -e 检查 .git（兼容 worktree，.git 可能是文件）
    for SEARCH_PATH in "$HOME/dev" "$HOME/projects" "$HOME/code" "$HOME"; do
        if [[ -e "$SEARCH_PATH/$REPO_NAME/.git" ]]; then
            PROJECT_ROOT="$SEARCH_PATH/$REPO_NAME"
            break
        fi
    done

    if [[ -z "$PROJECT_ROOT" ]]; then
        echo "" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "  [ERROR] 找不到本地仓库: $TARGET_REPO" >&2
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
        echo "" >&2
        echo "如果要为其他仓库创建 PR，请先 cd 到该仓库目录" >&2
        echo "" >&2
        exit 2
    fi
else
    # L2 修复: 没有 --repo 参数，优先使用 git 获取项目根目录
    PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
    if [[ -z "$PROJECT_ROOT" ]]; then
        echo "[ERROR] 不在 git 仓库中" >&2
        exit 2
    fi
fi

cd "$PROJECT_ROOT" || { echo "[ERROR] 无法进入项目目录: $PROJECT_ROOT" >&2; exit 2; }

# ===== 模式检测 =====
# 1. 检查环境变量
MODE="${PR_GATE_MODE:-}"

# 2. 解析 --base 参数
# L1 修复: 使用单独的变量保存 --base 参数解析结果
PARSED_BASE=""
if [[ "$COMMAND" =~ --base=([^[:space:]]+) ]]; then
    PARSED_BASE="${BASH_REMATCH[1]}"
    PARSED_BASE="${PARSED_BASE//[\"\']/}"
elif [[ "$COMMAND" =~ --base[[:space:]]+([^[:space:]-][^[:space:]]*) ]]; then
    PARSED_BASE="${BASH_REMATCH[1]}"
    PARSED_BASE="${PARSED_BASE//[\"\']/}"
fi

if [[ -z "$MODE" ]]; then
    if [[ "$PARSED_BASE" == "main" ]]; then
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
if [[ -z "$CURRENT_BRANCH" ]]; then
    echo "[ERROR] 无法获取当前分支名" >&2
    exit 2
fi

# 读取配置的 base 分支（用于 PRD/DoD 检查）
# v4.4: 自动检测 base 分支（develop 优先，fallback 到 main）
BASE_BRANCH=$(git config "branch.$CURRENT_BRANCH.base-branch" 2>/dev/null || echo "")
if [[ -z "$BASE_BRANCH" ]] || ! git rev-parse "$BASE_BRANCH" >/dev/null 2>&1; then
    if git rev-parse develop >/dev/null 2>&1; then
        BASE_BRANCH="develop"
    elif git rev-parse main >/dev/null 2>&1; then
        BASE_BRANCH="main"
    else
        BASE_BRANCH="HEAD~10"
    fi
fi

echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
if [[ "$MODE" == "release" ]]; then
    echo "  PR GATE: Release 模式 (L1 + L2A + L2B + L3)" >&2
else
    echo "  PR GATE: PR 模式 (L1 + L2A)" >&2
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2

FAILED=0
CHECK_COUNT=0

# ============================================================================
# Part 0: 基础检查
# ============================================================================
echo "  [基础检查]" >&2

# 检查分支（正则与 branch-protect.sh 保持一致）
echo -n "  分支... " >&2
CHECK_COUNT=$((CHECK_COUNT + 1))
if [[ "${CURRENT_BRANCH:-}" =~ ^cp-[a-zA-Z0-9][-a-zA-Z0-9_]*$ ]] || \
   [[ "${CURRENT_BRANCH:-}" =~ ^feature/[a-zA-Z0-9][-a-zA-Z0-9_/]*$ ]]; then
    echo "[OK] ($CURRENT_BRANCH)" >&2
elif [[ "$MODE" == "release" && ( "$CURRENT_BRANCH" == "develop" || "$CURRENT_BRANCH" =~ ^release- ) ]]; then
    echo "[OK] ($CURRENT_BRANCH -> main)" >&2
else
    echo "[FAIL] ($CURRENT_BRANCH)" >&2
    echo "    -> PR 模式：必须在 cp-* 或 feature/* 分支" >&2
    echo "    -> Release 模式：允许 develop 或 release-* 分支" >&2
    FAILED=1
fi

# ============================================================================
# Part 0.5: CI Preflight（仅 PR 模式，快速预检）
# ============================================================================
if [[ "$MODE" == "pr" ]]; then
    echo "" >&2
    echo "  [CI Preflight: 快速预检]" >&2

    # 临时文件（使用统一管理）
    PREFLIGHT_OUTPUT=$(mktemp)
    TEMP_FILES+=("$PREFLIGHT_OUTPUT")

    # 检查 ci:preflight 脚本是否存在
    if [[ -f "scripts/devgate/ci-preflight.sh" ]]; then
        echo -n "  preflight... " >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))
        if run_with_timeout "$COMMAND_TIMEOUT" bash scripts/devgate/ci-preflight.sh >"$PREFLIGHT_OUTPUT" 2>&1; then
            echo "[OK]" >&2
        else
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                echo "[TIMEOUT - ${COMMAND_TIMEOUT}s]" >&2
                echo "    Preflight 超时，跳过详细检查" >&2
            else
                echo "[FAIL]" >&2
                tail -20 "$PREFLIGHT_OUTPUT" >&2 || true
                FAILED=1
            fi
        fi
    else
        echo "  ⚠️  ci-preflight.sh 不存在，跳过快速预检" >&2
    fi
fi

# ============================================================================
# Part 1: L1 - 自动化测试
# ============================================================================

# 检查是否可以信任缓存的质检结果
# v4.3: 分支级别质检文件隔离
SKIP_L1_TESTS=0
QUALITY_GATE_FILE="$PROJECT_ROOT/.quality-gate-passed-${CURRENT_BRANCH}"

# 向后兼容：如果新格式不存在，检查旧格式
if [[ ! -f "$QUALITY_GATE_FILE" && -f "$PROJECT_ROOT/.quality-gate-passed" ]]; then
    QUALITY_GATE_FILE="$PROJECT_ROOT/.quality-gate-passed"
fi

if [[ -f "$QUALITY_GATE_FILE" ]]; then
    # 获取文件修改时间
    if [[ "$(uname)" == "Darwin" ]]; then
        GATE_TIME=$(stat -f %m "$QUALITY_GATE_FILE" 2>/dev/null || echo 0)
    else
        GATE_TIME=$(stat -c %Y "$QUALITY_GATE_FILE" 2>/dev/null || echo 0)
    fi

    NOW=$(date +%s)
    AGE=$((NOW - GATE_TIME))

    # 如果质检文件在 5 分钟（300秒）内，信任它
    if [[ $AGE -lt 300 ]]; then
        SKIP_L1_TESTS=1
        echo "" >&2
        echo "  [L1: 自动化测试]" >&2
        echo "  ✅ 质检文件新鲜（${AGE}s 前），信任 qa:gate 结果，跳过重复测试" >&2
    fi
fi

if [[ $SKIP_L1_TESTS -eq 0 ]]; then
    echo "" >&2
    echo "  [L1: 自动化测试]" >&2

# L3 修复: 改用位标志检测项目类型
PROJECT_TYPE=0  # 位标志: 1=node, 2=python, 4=go
[[ -f "$PROJECT_ROOT/package.json" ]] && PROJECT_TYPE=$((PROJECT_TYPE | 1))
[[ -f "$PROJECT_ROOT/requirements.txt" || -f "$PROJECT_ROOT/pyproject.toml" ]] && PROJECT_TYPE=$((PROJECT_TYPE | 2))
[[ -f "$PROJECT_ROOT/go.mod" ]] && PROJECT_TYPE=$((PROJECT_TYPE | 4))

# 临时文件用于保存测试输出（使用统一管理）
TEST_OUTPUT_FILE=$(mktemp)
TEMP_FILES+=("$TEST_OUTPUT_FILE")

# Node.js 项目 (PROJECT_TYPE & 1)
if (( PROJECT_TYPE & 1 )); then
    # Typecheck
    if grep -q '"typecheck"' package.json 2>/dev/null; then
        echo -n "  typecheck... " >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))
        # L2 修复: 保存测试输出到文件
        # v3.1: 添加 timeout 保护
        if run_with_timeout "$COMMAND_TIMEOUT" npm run typecheck >"$TEST_OUTPUT_FILE" 2>&1; then
            echo "[OK]" >&2
        else
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                echo "[TIMEOUT - ${COMMAND_TIMEOUT}s]" >&2
                echo "    测试命令超时，可能卡住了" >&2
            else
                echo "[FAIL]" >&2
                # 显示最后几行错误
                tail -10 "$TEST_OUTPUT_FILE" >&2 || true
            fi
            FAILED=1
        fi
    fi

    # Lint
    if grep -q '"lint"' package.json 2>/dev/null; then
        echo -n "  lint... " >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))
        if run_with_timeout "$COMMAND_TIMEOUT" npm run lint >"$TEST_OUTPUT_FILE" 2>&1; then
            echo "[OK]" >&2
        else
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                echo "[TIMEOUT - ${COMMAND_TIMEOUT}s]" >&2
                echo "    测试命令超时，可能卡住了" >&2
            else
                echo "[FAIL]" >&2
                tail -10 "$TEST_OUTPUT_FILE" >&2 || true
            fi
            FAILED=1
        fi
    fi

    # Test
    if grep -q '"test"' package.json 2>/dev/null; then
        echo -n "  test... " >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))
        if run_with_timeout "$COMMAND_TIMEOUT" npm test >"$TEST_OUTPUT_FILE" 2>&1; then
            echo "[OK]" >&2
        else
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                echo "[TIMEOUT - ${COMMAND_TIMEOUT}s]" >&2
                echo "    测试命令超时，可能卡住了" >&2
            else
                echo "[FAIL]" >&2
                tail -10 "$TEST_OUTPUT_FILE" >&2 || true
            fi
            FAILED=1
        fi
    fi

    # Build
    if grep -q '"build"' package.json 2>/dev/null; then
        echo -n "  build... " >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))
        if run_with_timeout "$COMMAND_TIMEOUT" npm run build >"$TEST_OUTPUT_FILE" 2>&1; then
            echo "[OK]" >&2
        else
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                echo "[TIMEOUT - ${COMMAND_TIMEOUT}s]" >&2
                echo "    测试命令超时，可能卡住了" >&2
            else
                echo "[FAIL]" >&2
                tail -10 "$TEST_OUTPUT_FILE" >&2 || true
            fi
            FAILED=1
        fi
    fi
fi

# Python 项目 (PROJECT_TYPE & 2)
if (( PROJECT_TYPE & 2 )); then
    if [[ -d "$PROJECT_ROOT/tests" || -d "$PROJECT_ROOT/test" || -f "$PROJECT_ROOT/pytest.ini" ]]; then
        echo -n "  pytest... " >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))
        # L2 修复: 保存 pytest 输出
        # v3.1: 添加 timeout 保护
        if run_with_timeout "$COMMAND_TIMEOUT" pytest -q >"$TEST_OUTPUT_FILE" 2>&1; then
            echo "[OK]" >&2
        else
            EXIT_CODE=$?
            if [ $EXIT_CODE -eq 124 ]; then
                echo "[TIMEOUT - ${COMMAND_TIMEOUT}s]" >&2
                echo "    测试命令超时，可能卡住了" >&2
            else
                echo "[FAIL]" >&2
                tail -10 "$TEST_OUTPUT_FILE" >&2 || true
            fi
            FAILED=1
        fi
    fi
fi

# Go 项目 (PROJECT_TYPE & 4)
if (( PROJECT_TYPE & 4 )); then
    echo -n "  go test... " >&2
    CHECK_COUNT=$((CHECK_COUNT + 1))
    # L2 修复: 保存 go test 输出
    # v3.1: 添加 timeout 保护
    if run_with_timeout "$COMMAND_TIMEOUT" go test ./... >"$TEST_OUTPUT_FILE" 2>&1; then
        echo "[OK]" >&2
    else
        EXIT_CODE=$?
        if [ $EXIT_CODE -eq 124 ]; then
            echo "[TIMEOUT - ${COMMAND_TIMEOUT}s]" >&2
            echo "    测试命令超时，可能卡住了" >&2
        else
            echo "[FAIL]" >&2
            tail -10 "$TEST_OUTPUT_FILE" >&2 || true
        fi
        FAILED=1
    fi
fi

# Shell 脚本语法检查
SHELL_FAILED=0
SHELL_COUNT=0
SHELL_ERRORS=""
if [[ -d "$PROJECT_ROOT" ]]; then
    while IFS= read -r -d '' f; do
        SHELL_COUNT=$((SHELL_COUNT + 1))
        ERROR_OUTPUT=$(bash -n "$f" 2>&1) || {
            SHELL_FAILED=1
            SHELL_ERRORS+="    $f: $ERROR_OUTPUT"$'\n'
        }
    done < <(find "$PROJECT_ROOT" -name "*.sh" -type f -not -path "*/node_modules/*" -print0 2>/dev/null)
fi

if [[ $SHELL_COUNT -gt 0 ]]; then
    echo -n "  shell syntax... " >&2
    CHECK_COUNT=$((CHECK_COUNT + 1))
    if [[ $SHELL_FAILED -eq 0 ]]; then
        echo "[OK]" >&2
    else
        echo "[FAIL]" >&2
        if [[ -n "$SHELL_ERRORS" ]]; then
            echo "$SHELL_ERRORS" >&2
        fi
        FAILED=1
    fi
fi

fi  # 结束 SKIP_L1_TESTS 的 if 块

# ============================================================================
# Part 1.5: 版本号检查（警告模式，CI 强制）
# ============================================================================
# 检查 package.json 版本是否已更新（相对于 BASE_BRANCH）
# 仅警告，不阻止 - CI 会做强制检查
if [[ -f "$PROJECT_ROOT/package.json" ]]; then
    # 获取最近一次 commit 消息，判断是否跳过版本检查
    LAST_COMMIT_MSG=$(git log -1 --pretty=%B 2>/dev/null | head -1)
    SKIP_VERSION_CHECK=0

    # chore:/docs:/test: 开头的 commit 跳过版本检查
    if [[ "$LAST_COMMIT_MSG" =~ ^(chore|docs|test): ]]; then
        SKIP_VERSION_CHECK=1
    fi

    if [[ "$SKIP_VERSION_CHECK" -eq 0 ]]; then
        echo "" >&2
        echo "  [版本号检查]" >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))

        # 获取基准分支版本
        BASE_VERSION=$(git show "$BASE_BRANCH:package.json" 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version".*"\\([^"]*\\)".*/\\1/' 2>/dev/null || echo "")
        CURRENT_VERSION=$(grep '"version"' "$PROJECT_ROOT/package.json" | head -1 | sed 's/.*"version".*"\([^"]*\)".*/\1/' 2>/dev/null || echo "")

        if [[ -z "$BASE_VERSION" ]]; then
            echo "  ⚠️  无法获取 $BASE_BRANCH 的版本号（新仓库？）" >&2
        elif [[ -z "$CURRENT_VERSION" ]]; then
            echo "  ⚠️  无法获取当前 package.json 版本号" >&2
        elif [[ "$BASE_VERSION" == "$CURRENT_VERSION" ]]; then
            echo "  ⚠️  版本号未更新: $CURRENT_VERSION (与 $BASE_BRANCH 相同)" >&2
            echo "      → 建议在 PR 前更新版本号（CI 会强制检查）" >&2
            echo "      → 规则: fix: → patch, feat: → minor, feat!: → major" >&2
            # 仅警告，不设置 FAILED=1 - 让 CI 做强制检查
        else
            echo "  ✓ 版本号已更新: $BASE_VERSION → $CURRENT_VERSION" >&2
        fi
    fi
fi

# ============================================================================
# Part 2: PR 模式 - PRD + DoD 检查
# ============================================================================
if [[ "$MODE" == "pr" ]]; then
    # ===== Phase 1: DoD <-> Test 映射检查 =====
    DEVGATE_DIR="$PROJECT_ROOT/scripts/devgate"
    DOD_MAPPING_SCRIPT="$DEVGATE_DIR/check-dod-mapping.cjs"
    RCI_CHECK_SCRIPT="$DEVGATE_DIR/require-rci-update-if-p0p1.sh"

    # DoD 映射检查（如果脚本存在）
    if [[ -f "$DOD_MAPPING_SCRIPT" ]]; then
        echo "" >&2
        echo "  [Phase 1: DoD <-> Test 映射检查]" >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))
        if node "$DOD_MAPPING_SCRIPT" >&2 2>&1; then
            echo "" >&2
        else
            FAILED=1
        fi
    fi

    # P0/P1 强制 RCI 更新检查（如果脚本存在）
    if [[ -f "$RCI_CHECK_SCRIPT" ]]; then
        echo "" >&2
        echo "  [Phase 1: P0/P1 RCI 更新检查]" >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))
        if bash "$RCI_CHECK_SCRIPT" >&2 2>&1; then
            echo "" >&2
        else
            FAILED=1
        fi
    fi

    # ===== PRD 检查 =====
    echo "" >&2
    echo "  [PRD 检查]" >&2

    # v4.2: 支持分支级别 PRD/DoD 文件（优先新格式，fallback 旧格式）
    PRD_FILE_NEW="$PROJECT_ROOT/.prd-${CURRENT_BRANCH}.md"
    PRD_FILE_OLD="$PROJECT_ROOT/.prd.md"
    if [[ -f "$PRD_FILE_NEW" ]]; then
        PRD_FILE="$PRD_FILE_NEW"
        PRD_BASENAME=".prd-${CURRENT_BRANCH}.md"
    elif [[ -f "$PRD_FILE_OLD" ]]; then
        PRD_FILE="$PRD_FILE_OLD"
        PRD_BASENAME=".prd.md"
    else
        PRD_FILE=""
        PRD_BASENAME=".prd-${CURRENT_BRANCH}.md"
    fi

    echo -n "  PRD 文件... " >&2
    CHECK_COUNT=$((CHECK_COUNT + 1))
    if [[ -n "$PRD_FILE" && -f "$PRD_FILE" ]]; then
        # 检查 PRD 内容有效性
        PRD_LINES=$(clean_number "$(wc -l < "$PRD_FILE" 2>/dev/null)")
        PRD_HAS_CONTENT=$(clean_number "$(grep -cE '(功能描述|成功标准|需求来源|描述|标准)' "$PRD_FILE" 2>/dev/null || echo 0)")

        if [[ "$PRD_LINES" -lt 3 || "$PRD_HAS_CONTENT" -eq 0 ]]; then
            echo "[FAIL] (内容无效)" >&2
            echo "    -> PRD 需要至少 3 行，且包含关键字段（功能描述/成功标准）" >&2
            FAILED=1
        else
            # 检查 PRD 是否在当前分支有修改
            PRD_MODIFIED=$(clean_number "$(git diff "$BASE_BRANCH" --name-only 2>/dev/null | grep -cE "^$PRD_BASENAME$" || echo 0)")
            PRD_NEW=$(clean_number "$(git status --porcelain 2>/dev/null | grep -c "$PRD_BASENAME" || echo 0)")

            if [[ "$PRD_MODIFIED" -gt 0 || "$PRD_NEW" -gt 0 ]]; then
                echo "[OK]" >&2
            else
                PRD_IN_BRANCH=$(clean_number "$(git log "$BASE_BRANCH"..HEAD --name-only 2>/dev/null | grep -cE "^$PRD_BASENAME$" || echo 0)")
                if [[ "$PRD_IN_BRANCH" -gt 0 ]]; then
                    echo "[OK] (本分支已提交)" >&2
                else
                    echo "[FAIL] ($PRD_BASENAME 未更新)" >&2
                    echo "    -> 当前 PRD 是旧任务的，请为本次任务更新 PRD" >&2
                    FAILED=1
                fi
            fi
        fi
    else
        echo "[FAIL] ($PRD_BASENAME 不存在)" >&2
        echo "    -> 请创建 $PRD_BASENAME 记录需求" >&2
        FAILED=1
    fi

    # ===== DoD 检查 =====
    echo "" >&2
    echo "  [DoD 检查]" >&2

    # v4.2: 支持分支级别 DoD 文件
    DOD_FILE_NEW="$PROJECT_ROOT/.dod-${CURRENT_BRANCH}.md"
    DOD_FILE_OLD="$PROJECT_ROOT/.dod.md"
    if [[ -f "$DOD_FILE_NEW" ]]; then
        DOD_FILE="$DOD_FILE_NEW"
        DOD_BASENAME=".dod-${CURRENT_BRANCH}.md"
    elif [[ -f "$DOD_FILE_OLD" ]]; then
        DOD_FILE="$DOD_FILE_OLD"
        DOD_BASENAME=".dod.md"
    else
        DOD_FILE=""
        DOD_BASENAME=".dod-${CURRENT_BRANCH}.md"
    fi

    echo -n "  DoD 文件... " >&2
    CHECK_COUNT=$((CHECK_COUNT + 1))

    if [[ -z "$DOD_FILE" || ! -f "$DOD_FILE" ]]; then
        echo "[FAIL] ($DOD_BASENAME 不存在)" >&2
        echo "    -> 必须提供 $DOD_BASENAME 作为验收清单" >&2
        FAILED=1
    else
        # 两阶段友好：不再要求"本次必须修改过"，改为"DoD 是否完成"
        # 只要还有未勾项，就认为本次验收未完成
        DOD_UNCHECKED=$(clean_number "$(grep -cE '^[[:space:]]*-[[:space:]]*\[[[:space:]]\]' "$DOD_FILE" 2>/dev/null || echo 0)")

        if [[ "$DOD_UNCHECKED" -gt 0 ]]; then
            echo "[FAIL] (DoD 未完成：仍有未勾选项 $DOD_UNCHECKED)" >&2
            echo "    -> 请完成验收并勾选 .dod.md 中所有条目后再提交 PR" >&2
            FAILED=1
        else
            # 仅作提示：本次是否修改过（不作为门槛）
            DOD_TOUCHED=$(clean_number "$(git diff "$BASE_BRANCH" --name-only 2>/dev/null | grep -cE "^$DOD_BASENAME$" || echo 0)")
            if [[ "$DOD_TOUCHED" -gt 0 ]]; then
                echo "[OK] (本次已更新 & 全勾)" >&2
            else
                echo "[OK] (全勾)" >&2
            fi
        fi
    fi

    # ===== Phase 6: Skill 产物检查 =====
    echo "" >&2
    echo "  [Phase 6: Skill 产物检查]" >&2

    # 检查 .dod.md 是否引用 QA 决策
    echo -n "  DoD 引用 QA 决策... " >&2
    CHECK_COUNT=$((CHECK_COUNT + 1))
    if [[ -f "$DOD_FILE" ]]; then
        DOD_HAS_QA_REF=$(clean_number "$(grep -c '^QA:' "$DOD_FILE" 2>/dev/null || echo 0)")
        if [[ "$DOD_HAS_QA_REF" -gt 0 ]]; then
            echo "[OK]" >&2
        else
            echo "[FAIL] (缺少 QA: 引用)" >&2
            echo "    -> DoD 必须包含 'QA: docs/QA-DECISION.md' 引用" >&2
            FAILED=1
        fi
    else
        echo "[SKIP] (DoD 不存在)" >&2
    fi

    # 检查 QA-DECISION.md 存在且内容有效
    QA_DECISION_FILE="$PROJECT_ROOT/docs/QA-DECISION.md"
    echo -n "  QA 决策文件... " >&2
    CHECK_COUNT=$((CHECK_COUNT + 1))
    if [[ -f "$QA_DECISION_FILE" ]]; then
        # 允许：前导空格、Markdown #、Decision 大小写、冒号后空格
        QA_HAS_DECISION=$(clean_number "$(grep -cEi '^[#[:space:]]*Decision[[:space:]]*:' "$QA_DECISION_FILE" 2>/dev/null || echo 0)")
        QA_FILE_SIZE=$(wc -c < "$QA_DECISION_FILE" 2>/dev/null || echo 0)

        if [[ "$QA_FILE_SIZE" -lt 10 ]]; then
            echo "[FAIL] (QA-DECISION.md 为空或内容过少)" >&2
            FAILED=1
        elif [[ "$QA_HAS_DECISION" -eq 0 ]]; then
            echo "[FAIL] (缺少 Decision 字段)" >&2
            echo "    -> QA-DECISION.md 必须包含 'Decision: ...' 字段（允许空格/大小写）" >&2
            FAILED=1
        else
            echo "[OK]" >&2
        fi
    else
        echo "[FAIL] (docs/QA-DECISION.md 不存在)" >&2
        echo "    -> 请调用 /qa skill 生成 QA 决策" >&2
        GATE_FAILED=1  # Bug #7 修复: QA Decision 缺失是硬阻塞
    fi

    # 检查 AUDIT-REPORT.md 存在且 Decision: PASS
    AUDIT_REPORT_FILE="$PROJECT_ROOT/docs/AUDIT-REPORT.md"
    echo -n "  审计报告文件... " >&2
    CHECK_COUNT=$((CHECK_COUNT + 1))
    if [[ -f "$AUDIT_REPORT_FILE" ]]; then
        # 允许：前导空格、Markdown #、Decision 大小写、PASS/FAIL 大小写、冒号后空格
        AUDIT_PASS=$(clean_number "$(grep -cEi '^[#[:space:]]*Decision[[:space:]]*:[[:space:]]*PASS([[:space:]]|$)' "$AUDIT_REPORT_FILE" 2>/dev/null || echo 0)")
        AUDIT_FAIL=$(clean_number "$(grep -cEi '^[#[:space:]]*Decision[[:space:]]*:[[:space:]]*FAIL([[:space:]]|$)' "$AUDIT_REPORT_FILE" 2>/dev/null || echo 0)")
        AUDIT_HAS_DECISION=$(clean_number "$(grep -cEi '^[#[:space:]]*Decision[[:space:]]*:' "$AUDIT_REPORT_FILE" 2>/dev/null || echo 0)")

        if [[ "$AUDIT_PASS" -gt 0 ]]; then
            echo "[OK] (PASS)" >&2
        elif [[ "$AUDIT_FAIL" -gt 0 ]]; then
            echo "[FAIL] (Decision: FAIL)" >&2
            echo "    -> 必须先运行 /audit 并修复到 PASS 才能提交 PR" >&2
            FAILED=1
        elif [[ "$AUDIT_HAS_DECISION" -gt 0 ]]; then
            echo "[FAIL] (Decision 不是 PASS/FAIL)" >&2
            echo "    -> Decision 必须明确为 PASS 或 FAIL" >&2
            FAILED=1
        else
            echo "[FAIL] (缺少 Decision 字段)" >&2
            FAILED=1
        fi
    else
        echo "[FAIL] (docs/AUDIT-REPORT.md 不存在)" >&2
        GATE_FAILED=1  # Bug #7 修复: Audit Report 缺失是硬阻塞
    fi

    # L2B-min 检查（PR to develop 也需要证据）
    echo "" >&2
    echo "  [L2B-min: 可复核证据]" >&2
    L2B_SCRIPT="$PROJECT_ROOT/scripts/devgate/l2b-check.sh"
    if [[ -f "$L2B_SCRIPT" ]]; then
        echo -n "  证据文件... " >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))
        if bash "$L2B_SCRIPT" pr >&2 2>&1; then
            echo "" >&2
        else
            echo "    -> 请创建 .layer2-evidence.md 记录可复核证据" >&2
            FAILED=1
        fi
    else
        echo "  ⚠️  l2b-check.sh 不存在，跳过证据检查" >&2
    fi

    # ===== Gate 文件检查（v19: 强制 gate 审核通过，v20: 阻止型，v21: 硬失败+分层错误）=====
    echo "" >&2
    echo "  [Gate 审核文件检查]" >&2

    GATE_VERIFY_SCRIPT="$PROJECT_ROOT/scripts/gate/verify-gate-signature.sh"
    GATE_FILES=(".gate-prd-passed" ".gate-dod-passed" ".gate-test-passed" ".gate-audit-passed")
    GATE_NAMES=("gate:prd" "gate:dod" "gate:test" "gate:audit")
    GATE_FAILED=0  # v20: Gate 检查失败是阻止型（exit 2）

    # v22: 检查 verify 脚本是否存在 - 改为软警告（不阻断）
    # P0-1 修复：新项目可能还没有 verify 脚本，不应该死锁
    GATE_VERIFY_AVAILABLE=1
    if [[ ! -f "$GATE_VERIFY_SCRIPT" ]]; then
        echo "  [WARN] verify-gate-signature.sh 不存在" >&2
        echo "    -> 脚本路径: $GATE_VERIFY_SCRIPT" >&2
        echo "    -> Gate 签名验证已跳过" >&2
        echo "    -> 建议: 运行 generate-gate-file.sh 初始化 Gate 机制" >&2
        echo "" >&2
        GATE_VERIFY_AVAILABLE=0
        # 不 exit 2，继续执行其他检查
    fi

    for i in "${!GATE_FILES[@]}"; do
        GATE_FILE="$PROJECT_ROOT/${GATE_FILES[$i]}"
        GATE_NAME="${GATE_NAMES[$i]}"

        echo -n "  $GATE_NAME... " >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))

        if [[ ! -f "$GATE_FILE" ]]; then
            echo "[FAIL] (文件不存在)" >&2
            echo "    -> 必须先通过 $GATE_NAME 审核" >&2
            FAILED=1
            GATE_FAILED=1
        else
            # v22: 如果验证器不可用，跳过签名验证（只检查文件存在）
            if [[ "$GATE_VERIFY_AVAILABLE" -eq 0 ]]; then
                echo "[OK] (签名验证已跳过)" >&2
            else
                # P0-3 修复：运行 verify 脚本并加超时保护（防止卡死）
                GATE_EXIT_CODE=0
                GATE_OUTPUT=$(run_with_timeout 10 bash "$GATE_VERIFY_SCRIPT" "$GATE_FILE" 2>&1) || GATE_EXIT_CODE=$?

                # 超时处理（exit code 124）
                if [[ "$GATE_EXIT_CODE" -eq 124 ]]; then
                    echo "[FAIL] (验证超时)" >&2
                    echo "    -> verify-gate-signature.sh 超时（>10s）" >&2
                    FAILED=1
                    GATE_FAILED=1
                    continue
                fi

                case $GATE_EXIT_CODE in
                    0)
                        echo "[OK]" >&2
                        ;;
                    3)
                        # 验证器缺失/配置错误（secret 不存在）
                        echo "[FAIL] (配置错误)" >&2
                        echo "    -> Secret 文件不存在，请先运行 generate-gate-file.sh" >&2
                        FAILED=1
                        GATE_FAILED=1
                        ;;
                    4)
                        # 输入格式错误/JSON 解析失败
                        echo "[FAIL] (格式错误)" >&2
                        echo "    -> Gate 文件格式无效或 JSON 解析失败" >&2
                        echo "    -> $GATE_OUTPUT" >&2
                        FAILED=1
                        GATE_FAILED=1
                        ;;
                    5)
                        # 签名/校验失败
                        echo "[FAIL] (签名无效)" >&2
                        echo "    -> 文件可能被篡改或 secret 不匹配" >&2
                        echo "    -> 请重新运行对应的 gate skill 生成新文件" >&2
                        FAILED=1
                        GATE_FAILED=1
                        ;;
                    6)
                        # 分支/任务不匹配
                        echo "[FAIL] (分支不匹配)" >&2
                        echo "    -> Gate 文件是在其他分支生成的" >&2
                        echo "    -> $GATE_OUTPUT" >&2
                        FAILED=1
                        GATE_FAILED=1
                        ;;
                    7)
                        # v3: Gate 文件已过期
                        echo "[FAIL] (已过期)" >&2
                        echo "    -> Gate 文件已超过 30 分钟有效期" >&2
                        echo "    -> 请重新运行对应的 gate skill 生成新文件" >&2
                        FAILED=1
                        GATE_FAILED=1
                        ;;
                    8)
                        # v3: HEAD 不匹配
                        echo "[FAIL] (HEAD 不匹配)" >&2
                        echo "    -> 代码已变更，Gate 文件需要重新生成" >&2
                        echo "    -> $GATE_OUTPUT" >&2
                        FAILED=1
                        GATE_FAILED=1
                        ;;
                    9)
                        # v3: Repo ID 不匹配
                        echo "[FAIL] (Repo 不匹配)" >&2
                        echo "    -> Gate 文件是在其他仓库生成的" >&2
                        FAILED=1
                        GATE_FAILED=1
                        ;;
                    *)
                        # 其他错误
                        echo "[FAIL] (未知错误: exit $GATE_EXIT_CODE)" >&2
                        echo "    -> $GATE_OUTPUT" >&2
                        FAILED=1
                        GATE_FAILED=1
                        ;;
                esac
            fi
        fi
    done
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
        CHECK_COUNT=$((CHECK_COUNT + 1))
        if [[ -f "$L2_EVIDENCE_FILE" ]]; then
            echo "[OK]" >&2
        else
            echo "[FAIL] (.layer2-evidence.md 不存在)" >&2
            FAILED=1
        fi

        echo "" >&2
        echo "  [L3: Acceptance 校验]" >&2

        # L2 修复: 避免变量命名冲突，使用 RELEASE_DOD_FILE
        RELEASE_DOD_FILE="$PROJECT_ROOT/.dod.md"

        echo -n "  DoD 文件... " >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))
        if [[ -f "$RELEASE_DOD_FILE" ]]; then
            echo "[OK]" >&2
        else
            echo "[FAIL] (.dod.md 不存在)" >&2
            FAILED=1
        fi

        if [[ -f "$RELEASE_DOD_FILE" ]]; then
            # L2 修复: 支持大小写 [x] 和 [X]
            UNCHECKED_COUNT=$(clean_number "$(grep -c '\- \[ \]' "$RELEASE_DOD_FILE" 2>/dev/null || echo 0)")
            CHECKED_COUNT=$(clean_number "$(grep -cE '\- \[[xX]\]' "$RELEASE_DOD_FILE" 2>/dev/null || echo 0)")
            TOTAL_COUNT=$((UNCHECKED_COUNT + CHECKED_COUNT))

            echo -n "  验收项... " >&2
            CHECK_COUNT=$((CHECK_COUNT + 1))
            # A1 fix: 空 DoD（无验收项）必须 fail
            if [[ "$TOTAL_COUNT" -eq 0 ]]; then
                echo "[FAIL] (DoD 无验收项，至少需要 1 个 checkbox)" >&2
                FAILED=1
            elif [[ "$UNCHECKED_COUNT" -eq 0 && "$CHECKED_COUNT" -gt 0 ]]; then
                echo "[OK] ($CHECKED_COUNT 项全部完成)" >&2
            else
                echo "[FAIL] ($UNCHECKED_COUNT 项未完成)" >&2
                FAILED=1
            fi
        fi
    fi
fi

# ============================================================================
# 结果输出
# ============================================================================
echo "" >&2

# v20: Gate 文件检查失败是阻止型（必须通过 gate 审核）
if [[ "${GATE_FAILED:-0}" -eq 1 ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [ERROR] Gate 审核未通过（阻止型）" >&2
    echo "" >&2
    echo "  必须先通过以下 gate 审核才能创建 PR：" >&2
    echo "    - gate:prd  (PRD 审核)" >&2
    echo "    - gate:dod  (DoD 审核)" >&2
    echo "    - gate:test (测试审核)" >&2
    echo "    - gate:audit (审计审核)" >&2
    echo "" >&2
    echo "  请调用对应的 gate skill 完成审核。" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2
fi

if [[ $FAILED -eq 1 ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [WARNING] PR Gate 检查有问题（提示型，不阻断）" >&2
    echo "" >&2
    echo "  上述问题会在 CI 中检查，如果 CI 通过即可合并。" >&2
    echo "  PR Gate 仅提供快速反馈，不是决定性门槛。" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    # 提示型 Gate：exit 0（允许继续）
    exit 0
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
if [[ "$MODE" == "release" ]]; then
    echo "  [OK] Release Gate 通过" >&2
else
    echo "  [OK] PR Gate 通过 ($CHECK_COUNT 项)" >&2
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

exit 0
