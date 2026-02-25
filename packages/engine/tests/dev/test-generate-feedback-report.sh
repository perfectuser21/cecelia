#!/usr/bin/env bash
#
# test-generate-feedback-report.sh
# 测试 generate-feedback-report.sh 脚本

set -euo pipefail

# ============================================================================
# 测试配置
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRIPT_PATH="$PROJECT_ROOT/skills/dev/scripts/generate-feedback-report.sh"

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

test_generates_json() {
    # 创建临时目录
    local temp_dir
    temp_dir=$(mktemp -d)
    cd "$temp_dir"

    # 初始化 git repo
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"

    # 创建 develop 分支
    echo "test" > test.txt
    git add test.txt
    git commit -q -m "Initial commit"
    git checkout -q -b develop

    # 创建 mock .dev-mode
    cat > .dev-mode <<EOF
dev
branch: test-branch
task_id: task-001
EOF

    # 创建 mock quality-summary.json
    cat > quality-summary.json <<EOF
{
  "note": "Test summary",
  "changes": {}
}
EOF

    # 创建测试分支并做一些改动
    git checkout -q -b test-branch
    echo "new content" >> test.txt
    git add test.txt
    git commit -q -m "Test commit"

    # 运行脚本
    bash "$SCRIPT_PATH" task-001 >/dev/null 2>&1

    # 检查 JSON 文件是否生成
    local result=0
    if [[ -f ".dev-feedback-report.json" ]]; then
        result=0
    else
        result=1
    fi

    # 清理
    cd - >/dev/null
    rm -rf "$temp_dir"

    return $result
}

test_json_format_valid() {
    # 创建临时目录
    local temp_dir
    temp_dir=$(mktemp -d)
    cd "$temp_dir"

    # 初始化 git repo
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"

    # 创建 develop 分支
    echo "test" > test.txt
    git add test.txt
    git commit -q -m "Initial commit"
    git checkout -q -b develop

    # 创建 mock 文件
    cat > .dev-mode <<EOF
dev
branch: test-branch
task_id: task-001
EOF

    cat > quality-summary.json <<EOF
{
  "note": "Test summary",
  "changes": {}
}
EOF

    # 创建测试分支
    git checkout -q -b test-branch
    echo "new" >> test.txt
    git add test.txt
    git commit -q -m "Test"

    # 运行脚本
    bash "$SCRIPT_PATH" task-001 >/dev/null 2>&1

    # 验证 JSON 格式
    local result=0
    if jq . .dev-feedback-report.json >/dev/null 2>&1; then
        result=0
    else
        result=1
    fi

    # 清理
    cd - >/dev/null
    rm -rf "$temp_dir"

    return $result
}

test_all_fields_present() {
    # 创建临时目录
    local temp_dir
    temp_dir=$(mktemp -d)
    cd "$temp_dir"

    # 初始化 git repo
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"

    # 创建 develop 分支
    echo "test" > test.txt
    git add test.txt
    git commit -q -m "Initial commit"
    git checkout -q -b develop

    # 创建 mock 文件
    cat > .dev-mode <<EOF
dev
branch: test-branch
task_id: task-001
EOF

    cat > quality-summary.json <<EOF
{
  "note": "Test summary",
  "changes": {}
}
EOF

    # 创建测试分支
    git checkout -q -b test-branch
    echo "new" >> test.txt
    git add test.txt
    git commit -q -m "Test"

    # 运行脚本
    bash "$SCRIPT_PATH" task-001 >/dev/null 2>&1

    # 检查所有必需字段
    local required_fields=(
        "task_id"
        "branch"
        "pr_number"
        "completed_at"
        "summary"
        "issues_found"
        "next_steps_suggested"
        "technical_notes"
        "code_changes"
        "test_coverage"
        "performance_notes"
    )

    local result=0
    for field in "${required_fields[@]}"; do
        if ! jq -e ".$field" .dev-feedback-report.json >/dev/null 2>&1; then
            echo "  ❌ 缺少字段: $field"
            result=1
        fi
    done

    # 清理
    cd - >/dev/null
    rm -rf "$temp_dir"

    return $result
}

test_code_changes_structure() {
    # 创建临时目录
    local temp_dir
    temp_dir=$(mktemp -d)
    cd "$temp_dir"

    # 初始化 git repo
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"

    # 创建 develop 分支
    echo "test" > test.txt
    git add test.txt
    git commit -q -m "Initial commit"
    git checkout -q -b develop

    # 创建 mock 文件
    cat > .dev-mode <<EOF
dev
branch: test-branch
task_id: task-001
EOF

    cat > quality-summary.json <<EOF
{
  "note": "Test summary",
  "changes": {}
}
EOF

    # 创建测试分支
    git checkout -q -b test-branch
    echo "new" >> test.txt
    git add test.txt
    git commit -q -m "Test"

    # 运行脚本
    bash "$SCRIPT_PATH" task-001 >/dev/null 2>&1

    # 检查 code_changes 子字段
    local result=0
    if ! jq -e '.code_changes.files_modified' .dev-feedback-report.json >/dev/null 2>&1; then
        result=1
    fi
    if ! jq -e '.code_changes.lines_added' .dev-feedback-report.json >/dev/null 2>&1; then
        result=1
    fi
    if ! jq -e '.code_changes.lines_deleted' .dev-feedback-report.json >/dev/null 2>&1; then
        result=1
    fi
    if ! jq -e '.code_changes.net_lines' .dev-feedback-report.json >/dev/null 2>&1; then
        result=1
    fi

    # 清理
    cd - >/dev/null
    rm -rf "$temp_dir"

    return $result
}

test_handles_missing_dev_mode() {
    # 创建临时目录
    local temp_dir
    temp_dir=$(mktemp -d)
    cd "$temp_dir"

    # 初始化 git repo
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"

    # 创建 develop 分支
    echo "test" > test.txt
    git add test.txt
    git commit -q -m "Initial commit"
    git checkout -q -b develop

    # 不创建 .dev-mode，但提供参数
    # 创建测试分支
    git checkout -q -b test-branch
    echo "new" >> test.txt
    git add test.txt
    git commit -q -m "Test"

    # 运行脚本（应该不报错，task_id 使用参数）
    bash "$SCRIPT_PATH" task-manual >/dev/null 2>&1

    # 检查 JSON 生成且 task_id 正确
    local result=0
    if [[ -f ".dev-feedback-report.json" ]]; then
        local task_id
        task_id=$(jq -r '.task_id' .dev-feedback-report.json)
        if [[ "$task_id" == "task-manual" ]]; then
            result=0
        else
            result=1
        fi
    else
        result=1
    fi

    # 清理
    cd - >/dev/null
    rm -rf "$temp_dir"

    return $result
}

# ============================================================================
# 运行所有测试
# ============================================================================

main() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  generate-feedback-report.sh 测试套件"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    run_test "脚本存在且可执行" test_script_exists
    run_test "生成 JSON 文件" test_generates_json
    run_test "JSON 格式有效" test_json_format_valid
    run_test "所有必需字段存在" test_all_fields_present
    run_test "code_changes 结构正确" test_code_changes_structure
    run_test "处理缺失 .dev-mode 文件" test_handles_missing_dev_mode

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
