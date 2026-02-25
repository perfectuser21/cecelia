#!/usr/bin/env bash
# ============================================================================
# Stop Hook Router 集成测试
# ============================================================================
# 测试 stop.sh 路由器能否正确检测 mode 文件并调用对应 handler
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$PROJECT_ROOT/hooks"

# 测试计数
TESTS_PASSED=0
TESTS_FAILED=0

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ===== 测试辅助函数 =====

test_passed() {
    echo -e "${GREEN}✓${NC} $1"
    ((TESTS_PASSED++))
}

test_failed() {
    echo -e "${RED}✗${NC} $1"
    ((TESTS_FAILED++))
}

# ===== 测试 1: 路由器文件存在性检查 =====

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Stop Hook Router 测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "测试 1: 文件存在性检查"
echo "────────────────────────────────────────────────"

if [[ -f "$HOOKS_DIR/stop.sh" ]]; then
    test_passed "stop.sh 存在"
else
    test_failed "stop.sh 不存在"
fi

if [[ -f "$HOOKS_DIR/stop-dev.sh" ]]; then
    test_passed "stop-dev.sh 存在"
else
    test_failed "stop-dev.sh 不存在"
fi

if [[ -f "$HOOKS_DIR/stop-okr.sh" ]]; then
    test_passed "stop-okr.sh 存在"
else
    test_failed "stop-okr.sh 不存在"
fi

if [[ -f "$HOOKS_DIR/stop.sh.before-refactor" ]]; then
    test_passed "stop.sh.before-refactor 备份存在"
else
    test_failed "stop.sh.before-refactor 备份不存在"
fi

# ===== 测试 2: 路由器语法检查 =====

echo ""
echo "测试 2: 语法检查"
echo "────────────────────────────────────────────────"

if bash -n "$HOOKS_DIR/stop.sh" 2>/dev/null; then
    test_passed "stop.sh 语法正确"
else
    test_failed "stop.sh 语法错误"
fi

if bash -n "$HOOKS_DIR/stop-dev.sh" 2>/dev/null; then
    test_passed "stop-dev.sh 语法正确"
else
    test_failed "stop-dev.sh 语法错误"
fi

if bash -n "$HOOKS_DIR/stop-okr.sh" 2>/dev/null; then
    test_passed "stop-okr.sh 语法正确"
else
    test_failed "stop-okr.sh 语法错误"
fi

# ===== 测试 3: 路由器代码量检查 =====

echo ""
echo "测试 3: 路由器代码量检查（应该 < 50 行）"
echo "────────────────────────────────────────────────"

STOP_SH_LINES=$(wc -l < "$HOOKS_DIR/stop.sh")
if [[ $STOP_SH_LINES -lt 50 ]]; then
    test_passed "stop.sh 代码量: $STOP_SH_LINES 行（< 50 行）"
else
    test_failed "stop.sh 代码量: $STOP_SH_LINES 行（应该 < 50 行）"
fi

# ===== 测试 4: 路由器内容检查 =====

echo ""
echo "测试 4: 路由器内容检查"
echo "────────────────────────────────────────────────"

if grep -q "\.dev-mode" "$HOOKS_DIR/stop.sh"; then
    test_passed "stop.sh 包含 .dev-mode 检测"
else
    test_failed "stop.sh 缺少 .dev-mode 检测"
fi

if grep -q "stop-dev\.sh" "$HOOKS_DIR/stop.sh"; then
    test_passed "stop.sh 调用 stop-dev.sh"
else
    test_failed "stop.sh 未调用 stop-dev.sh"
fi

if grep -q "\.okr-mode" "$HOOKS_DIR/stop.sh"; then
    test_passed "stop.sh 包含 .okr-mode 检测"
else
    test_failed "stop.sh 缺少 .okr-mode 检测"
fi

if grep -q "stop-okr\.sh" "$HOOKS_DIR/stop.sh"; then
    test_passed "stop.sh 调用 stop-okr.sh"
else
    test_failed "stop.sh 未调用 stop-okr.sh"
fi

if grep -q "CECELIA_HEADLESS" "$HOOKS_DIR/stop.sh"; then
    test_passed "stop.sh 包含无头模式检测"
else
    test_failed "stop.sh 缺少无头模式检测"
fi

# ===== 测试 5: Handler 内容检查 =====

echo ""
echo "测试 5: Handler 内容检查"
echo "────────────────────────────────────────────────"

if grep -q "\.dev-mode" "$HOOKS_DIR/stop-dev.sh"; then
    test_passed "stop-dev.sh 检查 .dev-mode"
else
    test_failed "stop-dev.sh 未检查 .dev-mode"
fi

if grep -q "\.okr-mode" "$HOOKS_DIR/stop-okr.sh"; then
    test_passed "stop-okr.sh 检查 .okr-mode"
else
    test_failed "stop-okr.sh 未检查 .okr-mode"
fi

# ===== 测试 6: 功能测试（模拟场景）=====

echo ""
echo "测试 6: 功能测试（模拟场景）"
echo "────────────────────────────────────────────────"

# 测试 6.1: 架构文档存在性
if [[ -f "$PROJECT_ROOT/docs/STOP-HOOK-ARCHITECTURE.md" ]]; then
    test_passed "STOP-HOOK-ARCHITECTURE.md 存在"
else
    test_failed "STOP-HOOK-ARCHITECTURE.md 不存在"
fi

# 测试 6.2: 文档包含关键内容
if grep -q "路由器" "$PROJECT_ROOT/docs/STOP-HOOK-ARCHITECTURE.md" 2>/dev/null; then
    test_passed "文档包含路由器说明"
else
    test_failed "文档缺少路由器说明"
fi

if grep -q "添加.*Skill" "$PROJECT_ROOT/docs/STOP-HOOK-ARCHITECTURE.md" 2>/dev/null; then
    test_passed "文档包含扩展指南"
else
    test_failed "文档缺少扩展指南"
fi

# ===== 总结 =====

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  测试结果"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [[ $TESTS_FAILED -eq 0 ]]; then
    echo -e "${GREEN}✅ 所有测试通过${NC} ($TESTS_PASSED/$TESTS_PASSED)"
    echo ""
    exit 0
else
    echo -e "${RED}❌ 部分测试失败${NC} ($TESTS_PASSED 通过, $TESTS_FAILED 失败)"
    echo ""
    exit 1
fi
