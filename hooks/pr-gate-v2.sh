#!/usr/bin/env bash
# ============================================================================
# PreToolUse Hook: PR Gate v3.0
# ============================================================================
# PR -> develop: L1 全自动绿 + DoD 映射检查 + P0/P1 RCI 检查 + Skill 产物
# develop -> main: L1 绿 + L2B/L3 证据链齐全
# ============================================================================

set -euo pipefail

# ===== 工具函数 =====

# 清理数值：移除非数字字符，空值默认为 0
clean_number() {
    local val="${1:-0}"
    val="${val//[^0-9]/}"
    echo "${val:-0}"
}

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

# 只拦截 gh pr create
if [[ "$COMMAND" != *"gh pr create"* ]]; then
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
    for SEARCH_PATH in "$HOME/dev" "$HOME/projects" "$HOME/code" "$HOME"; do
        if [[ -d "$SEARCH_PATH/$REPO_NAME/.git" ]]; then
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
BASE_BRANCH=$(git config "branch.$CURRENT_BRANCH.base-branch" 2>/dev/null || echo "develop")

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
elif [[ "$MODE" == "release" && "$CURRENT_BRANCH" == "develop" ]]; then
    echo "[OK] ($CURRENT_BRANCH -> main)" >&2
else
    echo "[FAIL] ($CURRENT_BRANCH)" >&2
    echo "    -> PR 模式：必须在 cp-* 或 feature/* 分支" >&2
    echo "    -> Release 模式：允许 develop 分支" >&2
    FAILED=1
fi

# ============================================================================
# Part 1: L1 - 自动化测试
# ============================================================================
echo "" >&2
echo "  [L1: 自动化测试]" >&2

# L3 修复: 改用位标志检测项目类型
PROJECT_TYPE=0  # 位标志: 1=node, 2=python, 4=go
[[ -f "$PROJECT_ROOT/package.json" ]] && PROJECT_TYPE=$((PROJECT_TYPE | 1))
[[ -f "$PROJECT_ROOT/requirements.txt" || -f "$PROJECT_ROOT/pyproject.toml" ]] && PROJECT_TYPE=$((PROJECT_TYPE | 2))
[[ -f "$PROJECT_ROOT/go.mod" ]] && PROJECT_TYPE=$((PROJECT_TYPE | 4))

# 临时文件用于保存测试输出
TEST_OUTPUT_FILE=$(mktemp)
trap 'rm -f "$TEST_OUTPUT_FILE"' EXIT

# Node.js 项目 (PROJECT_TYPE & 1)
if (( PROJECT_TYPE & 1 )); then
    # Typecheck
    if grep -q '"typecheck"' package.json 2>/dev/null; then
        echo -n "  typecheck... " >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))
        # L2 修复: 保存测试输出到文件
        if npm run typecheck >"$TEST_OUTPUT_FILE" 2>&1; then
            echo "[OK]" >&2
        else
            echo "[FAIL]" >&2
            # 显示最后几行错误
            tail -10 "$TEST_OUTPUT_FILE" >&2 || true
            FAILED=1
        fi
    fi

    # Lint
    if grep -q '"lint"' package.json 2>/dev/null; then
        echo -n "  lint... " >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))
        if npm run lint >"$TEST_OUTPUT_FILE" 2>&1; then
            echo "[OK]" >&2
        else
            echo "[FAIL]" >&2
            tail -10 "$TEST_OUTPUT_FILE" >&2 || true
            FAILED=1
        fi
    fi

    # Test
    if grep -q '"test"' package.json 2>/dev/null; then
        echo -n "  test... " >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))
        if npm test >"$TEST_OUTPUT_FILE" 2>&1; then
            echo "[OK]" >&2
        else
            echo "[FAIL]" >&2
            tail -10 "$TEST_OUTPUT_FILE" >&2 || true
            FAILED=1
        fi
    fi

    # Build
    if grep -q '"build"' package.json 2>/dev/null; then
        echo -n "  build... " >&2
        CHECK_COUNT=$((CHECK_COUNT + 1))
        if npm run build >"$TEST_OUTPUT_FILE" 2>&1; then
            echo "[OK]" >&2
        else
            echo "[FAIL]" >&2
            tail -10 "$TEST_OUTPUT_FILE" >&2 || true
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
        if pytest -q >"$TEST_OUTPUT_FILE" 2>&1; then
            echo "[OK]" >&2
        else
            echo "[FAIL]" >&2
            tail -10 "$TEST_OUTPUT_FILE" >&2 || true
            FAILED=1
        fi
    fi
fi

# Go 项目 (PROJECT_TYPE & 4)
if (( PROJECT_TYPE & 4 )); then
    echo -n "  go test... " >&2
    CHECK_COUNT=$((CHECK_COUNT + 1))
    # L2 修复: 保存 go test 输出
    if go test ./... >"$TEST_OUTPUT_FILE" 2>&1; then
        echo "[OK]" >&2
    else
        echo "[FAIL]" >&2
        tail -10 "$TEST_OUTPUT_FILE" >&2 || true
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

    PRD_FILE="$PROJECT_ROOT/.prd.md"
    echo -n "  PRD 文件... " >&2
    CHECK_COUNT=$((CHECK_COUNT + 1))
    if [[ -f "$PRD_FILE" ]]; then
        # 检查 PRD 内容有效性
        PRD_LINES=$(clean_number "$(wc -l < "$PRD_FILE" 2>/dev/null)")
        PRD_HAS_CONTENT=$(clean_number "$(grep -cE '(功能描述|成功标准|需求来源|描述|标准)' "$PRD_FILE" 2>/dev/null || echo 0)")

        if [[ "$PRD_LINES" -lt 3 || "$PRD_HAS_CONTENT" -eq 0 ]]; then
            echo "[FAIL] (内容无效)" >&2
            echo "    -> PRD 需要至少 3 行，且包含关键字段（功能描述/成功标准）" >&2
            FAILED=1
        else
            # 检查 .prd.md 是否在当前分支有修改
            PRD_MODIFIED=$(clean_number "$(git diff "$BASE_BRANCH" --name-only 2>/dev/null | grep -c '^\.prd\.md$' || echo 0)")
            PRD_NEW=$(clean_number "$(git status --porcelain 2>/dev/null | grep -c '\.prd\.md' || echo 0)")

            if [[ "$PRD_MODIFIED" -gt 0 || "$PRD_NEW" -gt 0 ]]; then
                echo "[OK]" >&2
            else
                PRD_IN_BRANCH=$(clean_number "$(git log "$BASE_BRANCH"..HEAD --name-only 2>/dev/null | grep -c '^\.prd\.md$' || echo 0)")
                if [[ "$PRD_IN_BRANCH" -gt 0 ]]; then
                    echo "[OK] (本分支已提交)" >&2
                else
                    echo "[FAIL] (.prd.md 未更新)" >&2
                    echo "    -> 当前 .prd.md 是旧任务的，请为本次任务更新 PRD" >&2
                    FAILED=1
                fi
            fi
        fi
    else
        echo "[FAIL] (.prd.md 不存在)" >&2
        echo "    -> 请创建 .prd.md 记录需求" >&2
        FAILED=1
    fi

    # ===== DoD 检查 =====
    echo "" >&2
    echo "  [DoD 检查]" >&2

    DOD_FILE="$PROJECT_ROOT/.dod.md"
    echo -n "  DoD 文件... " >&2
    CHECK_COUNT=$((CHECK_COUNT + 1))
    if [[ -f "$DOD_FILE" ]]; then
        # 检查 DoD 内容有效性
        # L2 修复: DoD checkbox 正则支持大小写 x/X
        DOD_LINES=$(clean_number "$(wc -l < "$DOD_FILE" 2>/dev/null)")
        DOD_HAS_CHECKBOX=$(clean_number "$(grep -cE '^\s*-\s*\[[ xX]\]' "$DOD_FILE" 2>/dev/null || echo 0)")

        if [[ "$DOD_LINES" -lt 3 || "$DOD_HAS_CHECKBOX" -eq 0 ]]; then
            echo "[FAIL] (内容无效)" >&2
            echo "    -> DoD 需要至少 3 行，且包含验收清单 (- [ ] 格式)" >&2
            FAILED=1
        else
            # 检查 .dod.md 是否在当前分支有修改
            DOD_MODIFIED=$(clean_number "$(git diff "$BASE_BRANCH" --name-only 2>/dev/null | grep -c '^\.dod\.md$' || echo 0)")
            DOD_NEW=$(clean_number "$(git status --porcelain 2>/dev/null | grep -c '\.dod\.md' || echo 0)")

            if [[ "$DOD_MODIFIED" -gt 0 || "$DOD_NEW" -gt 0 ]]; then
                echo "[OK]" >&2
            else
                DOD_IN_BRANCH=$(clean_number "$(git log "$BASE_BRANCH"..HEAD --name-only 2>/dev/null | grep -c '^\.dod\.md$' || echo 0)")
                if [[ "$DOD_IN_BRANCH" -gt 0 ]]; then
                    echo "[OK] (本分支已提交)" >&2
                else
                    echo "[FAIL] (.dod.md 未更新)" >&2
                    echo "    -> 当前 .dod.md 是旧任务的，请为本次任务更新 DoD" >&2
                    FAILED=1
                fi
            fi
        fi
    else
        echo "[FAIL] (.dod.md 不存在)" >&2
        echo "    -> 请创建 .dod.md 记录 DoD 清单" >&2
        FAILED=1
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

    # 检查 QA-DECISION.md 存在
    QA_DECISION_FILE="$PROJECT_ROOT/docs/QA-DECISION.md"
    echo -n "  QA 决策文件... " >&2
    CHECK_COUNT=$((CHECK_COUNT + 1))
    if [[ -f "$QA_DECISION_FILE" ]]; then
        echo "[OK]" >&2
    else
        echo "[FAIL] (docs/QA-DECISION.md 不存在)" >&2
        echo "    -> 请调用 /qa skill 生成 QA 决策" >&2
        FAILED=1
    fi

    # 检查 AUDIT-REPORT.md 存在且 Decision: PASS
    AUDIT_REPORT_FILE="$PROJECT_ROOT/docs/AUDIT-REPORT.md"
    echo -n "  审计报告文件... " >&2
    CHECK_COUNT=$((CHECK_COUNT + 1))
    if [[ -f "$AUDIT_REPORT_FILE" ]]; then
        # 检查是否包含 Decision: PASS
        AUDIT_PASS=$(clean_number "$(grep -cE '^Decision:.*PASS' "$AUDIT_REPORT_FILE" 2>/dev/null || echo 0)")
        AUDIT_FAIL=$(clean_number "$(grep -cE '^Decision:.*FAIL' "$AUDIT_REPORT_FILE" 2>/dev/null || echo 0)")

        if [[ "$AUDIT_PASS" -gt 0 ]]; then
            echo "[OK] (PASS)" >&2
        elif [[ "$AUDIT_FAIL" -gt 0 ]]; then
            echo "[FAIL] (Decision: FAIL)" >&2
            echo "    -> 审计未通过，请修复 L1/L2 问题后重新 /audit" >&2
            FAILED=1
        else
            echo "[FAIL] (缺少 Decision 结论)" >&2
            echo "    -> 审计报告必须包含 'Decision: PASS' 或 'Decision: FAIL'" >&2
            FAILED=1
        fi
    else
        echo "[FAIL] (docs/AUDIT-REPORT.md 不存在)" >&2
        echo "    -> 请调用 /audit skill 生成审计报告" >&2
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

            echo -n "  验收项... " >&2
            CHECK_COUNT=$((CHECK_COUNT + 1))
            if [[ "$UNCHECKED_COUNT" -eq 0 && "$CHECKED_COUNT" -gt 0 ]]; then
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

if [[ $FAILED -eq 1 ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    echo "  [FAIL] PR Gate 检查失败" >&2
    echo "" >&2
    echo "  请修复上述问题后重试" >&2
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
    exit 2
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
if [[ "$MODE" == "release" ]]; then
    echo "  [OK] Release Gate 通过" >&2
else
    echo "  [OK] PR Gate 通过 ($CHECK_COUNT 项)" >&2
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

exit 0
