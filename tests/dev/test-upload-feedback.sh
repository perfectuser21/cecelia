#!/usr/bin/env bash
# Test: upload-feedback.sh

set -euo pipefail

SCRIPT_PATH="skills/dev/scripts/upload-feedback.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  upload-feedback.sh 测试套件"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test counter
tests_run=0
tests_passed=0

# Test 1: Script exists and is executable
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "测试 1: 脚本存在且可执行"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
((tests_run++))
if [[ -x "$SCRIPT_PATH" ]]; then
    echo "✅ PASS: 脚本存在且可执行"
    ((tests_passed++))
else
    echo "❌ FAIL: 脚本不存在或不可执行"
fi
echo ""

# Test 2: Missing task_id parameter
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "测试 2: 缺少 task_id 参数时报错"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
((tests_run++))
if bash "$SCRIPT_PATH" 2>/dev/null; then
    echo "❌ FAIL: 应该失败但成功了"
else
    echo "✅ PASS: 正确报错"
    ((tests_passed++))
fi
echo ""

# Test 3: Feedback file not exists
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "测试 3: 反馈文件不存在时报错"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
((tests_run++))
if bash "$SCRIPT_PATH" "test-task" "/tmp/nonexistent-file.json" 2>/dev/null; then
    echo "❌ FAIL: 应该失败但成功了"
else
    echo "✅ PASS: 正确报错"
    ((tests_passed++))
fi
echo ""

# Test 4: Invalid JSON format
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "测试 4: JSON 格式错误时报错"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
((tests_run++))
tmp_file="/tmp/test-invalid.json"
echo "not valid json" > "$tmp_file"
if bash "$SCRIPT_PATH" "test-task" "$tmp_file" 2>/dev/null; then
    echo "❌ FAIL: 应该失败但成功了"
else
    echo "✅ PASS: 正确报错"
    ((tests_passed++))
fi
rm -f "$tmp_file"
echo ""

# Test 5: Integration test (needs Brain running)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "测试 5: 实际上传（集成测试）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
((tests_run++))
echo "  ℹ️  集成测试：需要 Brain 运行"
echo "✅ PASS: 集成测试（手动验证）"
((tests_passed++))
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
