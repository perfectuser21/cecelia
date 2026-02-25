#!/usr/bin/env bash
# Stop Hook 基本检查测试

cd "$(dirname "$0")/.."

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Stop Hook 基本检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

PASS=0
FAIL=0

# 1. 文件存在性
if [[ -f hooks/stop.sh ]]; then echo "✓ stop.sh 存在"; ((PASS++)); else echo "✗ stop.sh 不存在"; ((FAIL++)); fi
if [[ -f hooks/stop-dev.sh ]]; then echo "✓ stop-dev.sh 存在"; ((PASS++)); else echo "✗ stop-dev.sh 不存在"; ((FAIL++)); fi
if [[ -f hooks/stop-okr.sh ]]; then echo "✓ stop-okr.sh 存在"; ((PASS++)); else echo "✗ stop-okr.sh 不存在"; ((FAIL++)); fi
if [[ -f hooks/stop.sh.before-refactor ]]; then echo "✓ 备份存在"; ((PASS++)); else echo "✗ 备份不存在"; ((FAIL++)); fi

# 2. 语法检查
if bash -n hooks/stop.sh 2>/dev/null; then echo "✓ stop.sh 语法正确"; ((PASS++)); else echo "✗ stop.sh 语法错误"; ((FAIL++)); fi
if bash -n hooks/stop-dev.sh 2>/dev/null; then echo "✓ stop-dev.sh 语法正确"; ((PASS++)); else echo "✗ stop-dev.sh 语法错误"; ((FAIL++)); fi
if bash -n hooks/stop-okr.sh 2>/dev/null; then echo "✓ stop-okr.sh 语法正确"; ((PASS++)); else echo "✗ stop-okr.sh 语法错误"; ((FAIL++)); fi

# 3. 代码量检查
LINES=$(wc -l < hooks/stop.sh)
if [[ $LINES -lt 50 ]]; then echo "✓ stop.sh 代码量: $LINES 行 (< 50)"; ((PASS++)); else echo "✗ stop.sh 过长: $LINES 行"; ((FAIL++)); fi

# 4. 内容检查
if grep -q "\.dev-mode" hooks/stop.sh; then echo "✓ 包含 .dev-mode 检测"; ((PASS++)); else echo "✗ 缺少 .dev-mode"; ((FAIL++)); fi
if grep -q "stop-dev\.sh" hooks/stop.sh; then echo "✓ 调用 stop-dev.sh"; ((PASS++)); else echo "✗ 未调用 stop-dev.sh"; ((FAIL++)); fi
if grep -q "\.okr-mode" hooks/stop.sh; then echo "✓ 包含 .okr-mode 检测"; ((PASS++)); else echo "✗ 缺少 .okr-mode"; ((FAIL++)); fi
if grep -q "stop-okr\.sh" hooks/stop.sh; then echo "✓ 调用 stop-okr.sh"; ((PASS++)); else echo "✗ 未调用 stop-okr.sh"; ((FAIL++)); fi

# 5. 文档检查
if [[ -f docs/STOP-HOOK-ARCHITECTURE.md ]]; then echo "✓ 架构文档存在"; ((PASS++)); else echo "✗ 文档不存在"; ((FAIL++)); fi
if grep -q "路由器" docs/STOP-HOOK-ARCHITECTURE.md 2>/dev/null; then echo "✓ 文档包含路由器说明"; ((PASS++)); else echo "✗ 缺少路由器说明"; ((FAIL++)); fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  结果: $PASS 通过, $FAIL 失败"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[[ $FAIL -eq 0 ]] && exit 0 || exit 1
