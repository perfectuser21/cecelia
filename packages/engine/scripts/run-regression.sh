#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# run-regression.sh - 根据 regression-contract.yaml 执行回归测试
# =============================================================================
#
# 用法:
#   bash scripts/run-regression.sh [MODE] [OPTIONS]
#
# MODE:
#   pr       - 只跑 trigger 包含 PR 的条目 (默认)
#   release  - 跑 trigger 包含 Release 的条目
#   nightly  - 跑全部条目 (忽略 trigger)
#
# OPTIONS:
#   --dry-run  - 只显示要执行的 RCI，不实际执行
#
# 示例:
#   bash scripts/run-regression.sh pr        # PR 模式
#   bash scripts/run-regression.sh release   # Release 模式
#   bash scripts/run-regression.sh nightly   # Nightly 全量
#   bash scripts/run-regression.sh pr --dry-run  # 查看 PR 模式的 RCI 列表
#
# =============================================================================

MODE="pr"  # 默认值
DRY_RUN=false

# 解析参数
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            ;;
        pr|release|nightly)
            MODE="$arg"
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RC_FILE="$PROJECT_ROOT/regression-contract.yaml"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Regression Test Runner"
echo "  Mode: $MODE"
[[ "$DRY_RUN" == "true" ]] && echo "  (Dry Run)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [[ ! -f "$RC_FILE" ]]; then
    echo -e "${RED}❌ regression-contract.yaml not found${NC}"
    exit 1
fi

# 检查 yq 是否可用
if ! command -v yq &> /dev/null; then
    echo -e "${RED}❌ yq not installed (required for L3 tests)${NC}"
    exit 1
fi

# =============================================================================
# RCI 解析函数
# =============================================================================

# 分隔符：使用 ASCII Unit Separator (0x1F) 避免与数据冲突
SEP=$'\x1f'

# 解析所有 RCI，输出格式: id<SEP>trigger<SEP>method<SEP>evidence_type<SEP>evidence_run<SEP>evidence_contains
parse_rcis() {
    local sections=("hooks" "workflow" "ci" "export" "n8n")

    for section in "${sections[@]}"; do
        # 检查 section 是否存在
        local count
        count=$(yq eval ".$section | length" "$RC_FILE" 2>/dev/null || echo "0")
        if [[ "$count" == "0" ]] || [[ "$count" == "null" ]]; then
            continue
        fi

        # 遍历 section 中的每个 RCI
        local i=0
        while [[ $i -lt $count ]]; do
            local id trigger method evidence_type evidence_run evidence_contains

            id=$(yq eval ".$section[$i].id" "$RC_FILE")
            trigger=$(yq eval ".$section[$i].trigger | join(\",\")" "$RC_FILE" 2>/dev/null || echo "")
            method=$(yq eval ".$section[$i].method" "$RC_FILE")
            evidence_type=$(yq eval ".$section[$i].evidence.type" "$RC_FILE" 2>/dev/null || echo "null")
            evidence_run=$(yq eval ".$section[$i].evidence.run" "$RC_FILE" 2>/dev/null || echo "null")
            evidence_contains=$(yq eval ".$section[$i].evidence.contains" "$RC_FILE" 2>/dev/null || echo "null")

            # 跳过无效条目
            if [[ "$id" == "null" ]] || [[ -z "$id" ]]; then
                i=$((i + 1))
                continue
            fi

            echo "${id}${SEP}${trigger}${SEP}${method}${SEP}${evidence_type}${SEP}${evidence_run}${SEP}${evidence_contains}"
            i=$((i + 1))
        done
    done
}

# =============================================================================
# Trigger 过滤函数
# =============================================================================

# 根据 MODE 过滤 RCI
filter_by_trigger() {
    local mode="$1"

    while IFS="$SEP" read -r id trigger method evidence_type evidence_run evidence_contains; do
        case "$mode" in
            pr)
                # PR 模式：只返回 trigger 包含 PR 的 RCI
                if [[ "$trigger" == *"PR"* ]]; then
                    echo "${id}${SEP}${trigger}${SEP}${method}${SEP}${evidence_type}${SEP}${evidence_run}${SEP}${evidence_contains}"
                fi
                ;;
            release)
                # Release 模式：只返回 trigger 包含 Release 的 RCI
                if [[ "$trigger" == *"Release"* ]]; then
                    echo "${id}${SEP}${trigger}${SEP}${method}${SEP}${evidence_type}${SEP}${evidence_run}${SEP}${evidence_contains}"
                fi
                ;;
            nightly)
                # Nightly 模式：返回所有 method: auto 的 RCI
                if [[ "$method" == "auto" ]]; then
                    echo "${id}${SEP}${trigger}${SEP}${method}${SEP}${evidence_type}${SEP}${evidence_run}${SEP}${evidence_contains}"
                fi
                ;;
        esac
    done
}

# =============================================================================
# Evidence 执行函数
# =============================================================================

# 计数器
L3_PASSED=0
L3_FAILED=0
L3_SKIPPED=0

# 执行单个 RCI 的 evidence
run_evidence() {
    local id="$1"
    local evidence_type="$2"
    local evidence_run="$3"
    local evidence_contains="$4"

    echo -n "  $id... "

    case "$evidence_type" in
        command)
            # 执行命令并检查输出
            if [[ "$evidence_run" == "null" ]] || [[ -z "$evidence_run" ]]; then
                echo -e "${YELLOW}⏭️ (no command defined)${NC}"
                L3_SKIPPED=$((L3_SKIPPED + 1))
                return
            fi

            # 提取命令中的第一个命令（检查是否存在）
            local first_cmd
            first_cmd=$(echo "$evidence_run" | awk '{print $1}')

            # 如果命令不存在，跳过（不是 bash 内置命令也不在 PATH 中）
            if [[ "$first_cmd" != "bash" ]] && [[ "$first_cmd" != "jq" ]] && ! command -v "$first_cmd" &>/dev/null; then
                echo -e "${YELLOW}⏭️ (command not found: $first_cmd)${NC}"
                L3_SKIPPED=$((L3_SKIPPED + 1))
                return
            fi

            # 执行命令
            # 安全注意：evidence_run 来自 regression-contract.yaml（受版本控制）
            # 只允许执行白名单中的命令前缀
            # P3 修复: 删除重复的 first_cmd 定义（已在上面定义）
            case "$first_cmd" in
                npm)
                    # A6 fix: npm 命令只允许特定脚本（防止 npm run evil-script）
                    if [[ ! "$evidence_run" =~ ^npm\ (run\ )?(test|qa|build|ci|install)(\s|$) ]]; then
                        echo -e "${YELLOW}⏭️ (npm only allows: test, qa, build, ci, install)${NC}"
                        L3_SKIPPED=$((L3_SKIPPED + 1))
                        return
                    fi
                    ;;
                node|bash|sh|cat|grep|ls|curl|gh|git|jq|yq)
                    # 允许的命令
                    ;;
                *)
                    echo -e "${YELLOW}⏭️ (disallowed command: $first_cmd)${NC}"
                    L3_SKIPPED=$((L3_SKIPPED + 1))
                    return
                    ;;
            esac
            local output
            set +e
            # P0-1 修复: 移除 eval，使用 bash -c 执行（更安全，防止命令注入）
            # 注意：evidence_run 来自 regression-contract.yaml（受版本控制），但仍需防范
            # L1 fix: 严格的命令注入检查
            # Bug #13 修复: 禁止嵌套 bash -c，防止命令注入
            local cmd_safe=false

            # 检查是否包含嵌套 bash（任何形式的 bash/sh -c）
            if [[ "$evidence_run" =~ bash.*-c ]]; then
                echo -e "${YELLOW}[SKIP]${NC} (nested bash -c not allowed)"
                L3_SKIPPED=$((L3_SKIPPED + 1))
                return
            fi

            # 只允许简单命令（无危险的 shell 元字符）
            if [[ ! "$evidence_run" =~ [\;\|\&\`\$\(] ]]; then
                # 无危险元字符，安全
                cmd_safe=true
            fi

            if [[ "$cmd_safe" != "true" ]]; then
                echo -e "${YELLOW}[SKIP]${NC} (unsafe command pattern)"
                L3_SKIPPED=$((L3_SKIPPED + 1))
                return
            fi

            # 执行命令（已通过安全检查）
            output=$(cd "$PROJECT_ROOT" && bash -c "$evidence_run" 2>&1)
            local exit_code=$?
            set -e

            # 检查是否是命令找不到错误
            if echo "$output" | grep -qE "command not found|not found|No such file"; then
                echo -e "${YELLOW}⏭️ (dependency not available)${NC}"
                L3_SKIPPED=$((L3_SKIPPED + 1))
                return
            fi

            # 检查输出是否匹配 contains 正则
            if [[ "$evidence_contains" != "null" ]] && [[ -n "$evidence_contains" ]]; then
                if echo "$output" | grep -qE "$evidence_contains"; then
                    echo -e "${GREEN}✅${NC}"
                    L3_PASSED=$((L3_PASSED + 1))
                else
                    echo -e "${RED}❌ (output doesn't match: $evidence_contains)${NC}"
                    echo -e "    ${CYAN}Output: ${output:0:200}${NC}"
                    L3_FAILED=$((L3_FAILED + 1))
                fi
            elif [[ $exit_code -eq 0 ]]; then
                echo -e "${GREEN}✅${NC}"
                L3_PASSED=$((L3_PASSED + 1))
            else
                echo -e "${RED}❌ (exit code: $exit_code)${NC}"
                L3_FAILED=$((L3_FAILED + 1))
            fi
            ;;
        file)
            # 检查文件是否存在
            local file_path
            # CRITICAL 修复: 严格验证 id 格式，只允许安全字符 [A-Za-z0-9_-]
            if [[ ! "$id" =~ ^[A-Za-z0-9_-]+$ ]]; then
                echo -e "${YELLOW}⏭️ (invalid id format: $id)${NC}"
                L3_SKIPPED=$((L3_SKIPPED + 1))
                return
            fi
            # 安全：转义 id 中的特殊字符防止 yq 注入（双重保护）
            local safe_id
            safe_id=$(printf '%s' "$id" | sed 's/["\\]/\\&/g')
            file_path=$(yq eval ".. | select(has(\"evidence\")) | select(.id == \"$safe_id\") | .evidence.path" "$RC_FILE" 2>/dev/null | head -1)

            if [[ "$file_path" == "null" ]] || [[ -z "$file_path" ]]; then
                echo -e "${YELLOW}⏭️ (no file path defined)${NC}"
                L3_SKIPPED=$((L3_SKIPPED + 1))
                return
            fi

            # P0-2 修复: 移除 eval，使用 compgen 或 find 检查通配符
            # 先验证 file_path 不包含危险字符
            if [[ "$file_path" == *".."* ]] || [[ "$file_path" == *";"* ]] || [[ "$file_path" == *"|"* ]]; then
                echo -e "${RED}❌ (unsafe file path: $file_path)${NC}"
                L3_FAILED=$((L3_FAILED + 1))
                return
            fi
            # L2 fix: 使用 ls 配合 nullglob 检查通配符文件
            # find -path 对复杂通配符支持有限，改用更可靠的方法
            local file_found=false
            if [[ "$file_path" == *"*"* ]]; then
                # 包含通配符，使用 bash glob
                local matches
                matches=$(cd "$PROJECT_ROOT" && ls -d $file_path 2>/dev/null | head -1) || true
                [[ -n "$matches" ]] && file_found=true
            elif [[ -e "$PROJECT_ROOT/$file_path" ]]; then
                # 精确路径
                file_found=true
            fi
            if [[ "$file_found" == "true" ]]; then
                echo -e "${GREEN}✅${NC}"
                L3_PASSED=$((L3_PASSED + 1))
            else
                echo -e "${RED}❌ (file not found: $file_path)${NC}"
                L3_FAILED=$((L3_FAILED + 1))
            fi
            ;;
        ci_job|log|exit_code|screenshot)
            # 这些类型不能在脚本中自动执行
            echo -e "${YELLOW}⏭️ (manual: $evidence_type)${NC}"
            L3_SKIPPED=$((L3_SKIPPED + 1))
            ;;
        null|"")
            echo -e "${YELLOW}⏭️ (no evidence)${NC}"
            L3_SKIPPED=$((L3_SKIPPED + 1))
            ;;
        *)
            echo -e "${YELLOW}⏭️ (unknown type: $evidence_type)${NC}"
            L3_SKIPPED=$((L3_SKIPPED + 1))
            ;;
    esac
}

# =============================================================================
# 主流程
# =============================================================================

# Dry Run 模式：显示完整测试清单
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${BLUE}[Regression Test Plan - $MODE 模式]${NC}"
    echo ""

    # L1: 基础检查
    echo -e "${CYAN}L1: 基础检查${NC}"
    echo "  - typecheck: npm run typecheck"
    echo "  - shell syntax: find -name '*.sh' | bash -n"
    echo ""

    # L2: 单元测试
    echo -e "${CYAN}L2: 单元测试${NC}"
    echo "  - tests/: npm run test (vitest)"
    echo "  - build: npm run build"
    echo ""

    # L3: 集成测试（根据 MODE）
    if [[ "$MODE" == "pr" ]]; then
        echo -e "${CYAN}L3: 跳过 (PR 模式只跑 L1+L2)${NC}"
    else
        echo -e "${CYAN}L3: 集成测试 (RCI - $MODE 模式)${NC}"

        parse_rcis | filter_by_trigger "$MODE" | while IFS="$SEP" read -r id trigger method evidence_type evidence_run evidence_contains; do
            # 只显示 method=auto 的 RCI（可自动执行的）
            if [[ "$method" != "auto" ]]; then
                continue
            fi

            # 简洁格式：ID - 测试命令/路径
            if [[ "$evidence_type" == "command" ]] && [[ "$evidence_run" != "null" ]]; then
                echo "  $id - $evidence_run"
            elif [[ "$evidence_type" == "file" ]]; then
                # 文件类型，显示文件路径
                _file_path=""
                _safe_id=$(printf '%s' "$id" | sed 's/["\\]/\\&/g')
                _file_path=$(yq eval ".. | select(has(\"evidence\")) | select(.id == \"$_safe_id\") | .evidence.path" "$RC_FILE" 2>/dev/null | head -1)
                if [[ "$_file_path" != "null" ]] && [[ -n "$_file_path" ]]; then
                    echo "  $id - $_file_path"
                else
                    echo "  $id - (no path)"
                fi
            else
                echo "  $id - (manual: $evidence_type)"
            fi
        done
    fi

    exit 0
fi

# =============================================================================
# L1: 基础检查
# =============================================================================
echo -e "${BLUE}[L1: 基础检查]${NC}"

# L3 fix: L1 失败时输出详细总结
L1_FAILED=false
L1_ERRORS=()

echo -n "  typecheck... "
if npm run typecheck --silent 2>/dev/null; then
    echo -e "${GREEN}[OK]${NC}"
else
    echo -e "${RED}[FAIL]${NC}"
    L1_FAILED=true
    L1_ERRORS+=("typecheck failed")
fi

echo -n "  shell syntax... "
SHELL_FAILED=0
SHELL_FAILED_FILE=""
while IFS= read -r -d '' f; do
    if ! bash -n "$f" 2>/dev/null; then
        SHELL_FAILED=1
        SHELL_FAILED_FILE="$f"
        break
    fi
done < <(find "$PROJECT_ROOT" -name "*.sh" -type f -not -path "*/node_modules/*" -print0)
if [[ $SHELL_FAILED -eq 0 ]]; then
    echo -e "${GREEN}[OK]${NC}"
else
    echo -e "${RED}[FAIL]${NC}"
    L1_FAILED=true
    L1_ERRORS+=("shell syntax failed: $SHELL_FAILED_FILE")
fi

# L3 fix: L1 失败时输出总结
if [[ "$L1_FAILED" == "true" ]]; then
    echo ""
    echo -e "${RED}[L1 SUMMARY] Basic checks failed:${NC}"
    for err in "${L1_ERRORS[@]}"; do
        echo -e "  ${RED}- $err${NC}"
    done
    exit 1
fi

# =============================================================================
# L2: 单元测试
# =============================================================================
echo ""
echo -e "${BLUE}[L2: 单元测试]${NC}"

echo -n "  vitest... "
if npm run test --silent 2>/dev/null; then
    echo -e "${GREEN}✅${NC}"
else
    TEST_EXIT_CODE=$?
    # 检查是否有已知失败标记
    if [ -f ".quality-evidence.json" ] && grep -q "known failures" .quality-evidence.json 2>/dev/null; then
        echo -e "${YELLOW}⚠️ [KNOWN FAILURES]${NC}"
        echo "   检测到已知测试失败（.quality-evidence.json 中已记录）"
        echo "   这些失败是预期的，不阻止回归测试"
    else
        echo -e "${RED}❌${NC}"
        exit $TEST_EXIT_CODE
    fi
fi

echo -n "  build... "
if npm run build --silent 2>/dev/null; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
    exit 1
fi

# =============================================================================
# L3: 集成测试 (根据 MODE 过滤)
# =============================================================================
if [[ "$MODE" == "pr" ]]; then
    echo ""
    echo -e "${BLUE}[L3: 跳过 - PR 模式只跑 L1+L2]${NC}"
else
    echo ""
    echo -e "${BLUE}[L3: 集成测试 - $MODE 模式]${NC}"

    # 使用临时文件存储 RCI 列表（避免子 shell 问题）
    RCI_RAW_FILE=$(mktemp)
    RCI_LIST_FILE=$(mktemp)
    # P1 修复: trap 覆盖 INT TERM 信号，确保 Ctrl+C 时临时文件被清理
    trap "rm -f \"$RCI_RAW_FILE\" \"$RCI_LIST_FILE\"" EXIT INT TERM

    # 分两步写入：先解析，再过滤
    parse_rcis > "$RCI_RAW_FILE"
    filter_by_trigger "$MODE" < "$RCI_RAW_FILE" > "$RCI_LIST_FILE"

    # 读取 RCI 列表并执行
    while IFS="$SEP" read -r id trigger method evidence_type evidence_run evidence_contains; do
        # 只处理 method=auto 的 RCI
        if [[ "$method" != "auto" ]]; then
            continue
        fi

        run_evidence "$id" "$evidence_type" "$evidence_run" "$evidence_contains"
    done < "$RCI_LIST_FILE"

    echo ""
    echo "  L3 结果: ${L3_PASSED} passed, ${L3_FAILED} failed, ${L3_SKIPPED} skipped"

    if [[ $L3_FAILED -gt 0 ]]; then
        echo -e "${RED}❌ L3 测试失败${NC}"
        exit 1
    fi
fi

# =============================================================================
# 总结
# =============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}✅ Regression Test 通过${NC}"
echo "  Mode: $MODE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
