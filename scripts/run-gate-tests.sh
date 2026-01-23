#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# run-gate-tests.sh - 执行 Gate Contract 测试
# =============================================================================
#
# 职责：确保"不发生灾难级误放行"
#
# 用法:
#   bash scripts/run-gate-tests.sh [OPTIONS]
#
# OPTIONS:
#   --dry-run  - 只显示要执行的测试，不实际执行
#   --verbose  - 显示详细输出
#
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GCI_FILE="$PROJECT_ROOT/contracts/gate-contract.yaml"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DRY_RUN=false
VERBOSE=false

# 解析参数
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            ;;
        --verbose)
            VERBOSE=true
            ;;
    esac
done

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Gate Contract Tests (GCI)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 检查 GCI 文件存在
if [[ ! -f "$GCI_FILE" ]]; then
    echo -e "${RED}[ERROR] Gate Contract 文件不存在: $GCI_FILE${NC}"
    exit 1
fi

# 读取版本
GCI_VERSION=$(grep "^version:" "$GCI_FILE" | head -1 | cut -d'"' -f2)
echo -e "  版本: ${GREEN}$GCI_VERSION${NC}"
echo ""

PASSED=0
FAILED=0
SKIPPED=0

# G1: DoD 验证
echo -e "${YELLOW}[G1] DoD 验证${NC}"
echo -n "  G1-001 空 DoD 必须被拒绝... "
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${BLUE}[DRY-RUN]${NC}"
    SKIPPED=$((SKIPPED + 1))
else
    if npm test -- tests/gate/gate.test.ts -t 'A1' --reporter=dot 2>/dev/null | grep -q "1 passed"; then
        echo -e "${GREEN}[PASS]${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}[FAIL]${NC}"
        FAILED=$((FAILED + 1))
    fi
fi

# G2: QA 验证
echo ""
echo -e "${YELLOW}[G2] QA 验证${NC}"
echo -n "  G2-001 空 QA-DECISION 必须被拒绝... "
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${BLUE}[DRY-RUN]${NC}"
    SKIPPED=$((SKIPPED + 1))
else
    if npm test -- tests/gate/gate.test.ts -t 'A2' --reporter=dot 2>/dev/null | grep -q "passed"; then
        echo -e "${GREEN}[PASS]${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}[FAIL]${NC}"
        FAILED=$((FAILED + 1))
    fi
fi

# G3: 优先级检测
echo ""
echo -e "${YELLOW}[G3] 优先级检测${NC}"
echo -n "  G3-001 P0wer 不应触发 P0... "
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${BLUE}[DRY-RUN]${NC}"
    SKIPPED=$((SKIPPED + 1))
else
    if npm test -- tests/gate/gate.test.ts -t 'A3' --reporter=dot 2>/dev/null | grep -q "passed"; then
        echo -e "${GREEN}[PASS]${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}[FAIL]${NC}"
        FAILED=$((FAILED + 1))
    fi
fi

# G5: 命令安全
echo ""
echo -e "${YELLOW}[G5] 命令安全${NC}"
echo -n "  G5-001 npm 命令限制... "
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${BLUE}[DRY-RUN]${NC}"
    SKIPPED=$((SKIPPED + 1))
else
    if npm test -- tests/gate/gate.test.ts -t 'A6' --reporter=dot 2>/dev/null | grep -q "passed"; then
        echo -e "${GREEN}[PASS]${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}[FAIL]${NC}"
        FAILED=$((FAILED + 1))
    fi
fi

# G6: 数据保护
echo ""
echo -e "${YELLOW}[G6] 数据保护${NC}"
echo -n "  G6-001 checkout 失败后不删除分支... "
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${BLUE}[DRY-RUN]${NC}"
    SKIPPED=$((SKIPPED + 1))
else
    if npm test -- tests/gate/gate.test.ts -t 'A7' --reporter=dot 2>/dev/null | grep -q "passed"; then
        echo -e "${GREEN}[PASS]${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}[FAIL]${NC}"
        FAILED=$((FAILED + 1))
    fi
fi

# 汇总
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [[ "$FAILED" -gt 0 ]]; then
    echo -e "  ${RED}[FAIL]${NC} Gate Tests: $PASSED passed, $FAILED failed, $SKIPPED skipped"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
else
    echo -e "  ${GREEN}[PASS]${NC} Gate Tests: $PASSED passed, $FAILED failed, $SKIPPED skipped"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 0
fi
