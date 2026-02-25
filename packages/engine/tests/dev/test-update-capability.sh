#!/usr/bin/env bash
# Test: update-capability.sh

set -euo pipefail

SCRIPT_PATH="skills/dev/scripts/update-capability.sh"
TEMP_DEV_MODE=$(mktemp)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  update-capability.sh 测试套件"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

tests_run=0
tests_passed=0

cleanup() {
    rm -f "$TEMP_DEV_MODE"
    rm -f ".dev-mode"
}
trap cleanup EXIT

# Test 1: 脚本存在且可执行
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "测试 1: 脚本存在且可执行"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
((tests_run++))
if [[ -x "$SCRIPT_PATH" ]]; then
    echo "✅ PASS: 脚本存在且可执行"
    ((tests_passed++))
else
    echo "❌ FAIL: 脚本不存在或不可执行 ($SCRIPT_PATH)"
fi
echo ""

# Test 2: 无 task_id（无参数，无 .dev-mode）→ 静默跳过
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "测试 2: 无 task_id 时静默跳过（exit 0）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
((tests_run++))
rm -f .dev-mode
output=$(bash "$SCRIPT_PATH" 2>&1)
exit_code=$?
if [[ $exit_code -eq 0 ]] && echo "$output" | grep -q "无 task_id"; then
    echo "✅ PASS: 正确静默跳过"
    ((tests_passed++))
else
    echo "❌ FAIL: 退出码=$exit_code, 输出: $output"
fi
echo ""

# Test 3: .dev-mode 有 task_id，Brain 不可用 → 静默跳过
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "测试 3: Brain 不可用时静默跳过"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
((tests_run++))
echo "task_id: test-uuid-1234" > .dev-mode
# 用一个不存在的端口模拟 Brain 不可用
output=$(BRAIN_URL="http://localhost:19999" bash "$SCRIPT_PATH" 2>&1)
exit_code=$?
if [[ $exit_code -eq 0 ]] && echo "$output" | grep -q "Brain API 不可用"; then
    echo "✅ PASS: Brain 不可用时正确跳过"
    ((tests_passed++))
else
    echo "❌ FAIL: 退出码=$exit_code, 输出: $output"
fi
rm -f .dev-mode
echo ""

# Test 4: task_id 从 .dev-mode 正确读取
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "测试 4: task_id 从 .dev-mode 读取"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
((tests_run++))
cat > .dev-mode <<'EOF'
dev
branch: cp-test
prd: .prd.md
task_id: abc-123-xyz
EOF
output=$(BRAIN_URL="http://localhost:19999" bash "$SCRIPT_PATH" 2>&1)
if echo "$output" | grep -q "abc-123-xyz\|Brain API 不可用"; then
    echo "✅ PASS: task_id 正确从 .dev-mode 读取"
    ((tests_passed++))
else
    echo "❌ FAIL: 未能读取 task_id，输出: $output"
fi
rm -f .dev-mode
echo ""

# Test 5: task_id 从参数读取
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "测试 5: task_id 从参数读取"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
((tests_run++))
output=$(BRAIN_URL="http://localhost:19999" bash "$SCRIPT_PATH" "param-task-id" 2>&1)
if echo "$output" | grep -q "param-task-id\|Brain API 不可用"; then
    echo "✅ PASS: task_id 从参数正确读取"
    ((tests_passed++))
else
    echo "❌ FAIL: 未能使用参数 task_id，输出: $output"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  测试结果"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  运行: $tests_run"
echo "  通过: $tests_passed"
echo "  失败: $((tests_run - tests_passed))"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $tests_passed -eq $tests_run ]]; then
    echo "✅ 所有测试通过"
    exit 0
else
    echo "❌ 有测试失败"
    exit 1
fi
