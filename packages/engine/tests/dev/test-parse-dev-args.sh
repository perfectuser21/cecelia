#!/usr/bin/env bash
#
# test-parse-dev-args.sh
# 测试 parse-dev-args.sh 脚本

set -euo pipefail

# ============================================================================
# 测试配置
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRIPT_PATH="$PROJECT_ROOT/skills/dev/scripts/parse-dev-args.sh"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# ============================================================================
# 测试框架
# ============================================================================

run_test() {
    local test_name="$1"
    local test_func="$2"

    TESTS_RUN=$((TESTS_RUN + 1))

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "测试 $TESTS_RUN: $test_name"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if $test_func; then
        echo "✅ PASS: $test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "❌ FAIL: $test_name"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# ============================================================================
# 测试用例
# ============================================================================

test_script_exists() {
    [[ -f "$SCRIPT_PATH" ]] && [[ -x "$SCRIPT_PATH" ]]
}

test_parse_task_id() {
    local result
    result=$(bash "$SCRIPT_PATH" --task-id task-001)
    [[ "$result" == "task-001" ]]
}

test_no_args() {
    local result
    result=$(bash "$SCRIPT_PATH")
    [[ -z "$result" ]]
}

test_ignore_unknown_args() {
    local result
    result=$(bash "$SCRIPT_PATH" --unknown-flag --task-id task-002 --another-flag)
    [[ "$result" == "task-002" ]]
}

test_missing_task_id_value() {
    # Script should exit with error code when --task-id has no value
    if bash "$SCRIPT_PATH" --task-id 2>/dev/null; then
        # Should not succeed
        return 1
    else
        # Should fail (exit non-zero)
        return 0
    fi
}

# ============================================================================
# 运行所有测试
# ============================================================================

main() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  parse-dev-args.sh 测试套件"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    run_test "脚本存在且可执行" test_script_exists
    run_test "解析 --task-id 参数" test_parse_task_id
    run_test "无参数时返回空" test_no_args
    run_test "忽略未知参数" test_ignore_unknown_args
    run_test "缺少 task-id 值时报错" test_missing_task_id_value

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  测试结果"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  运行: $TESTS_RUN"
    echo "  通过: $TESTS_PASSED"
    echo "  失败: $TESTS_FAILED"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if [[ $TESTS_FAILED -eq 0 ]]; then
        echo "✅ 所有测试通过"
        return 0
    else
        echo "❌ 有测试失败"
        return 1
    fi
}

main "$@"
