#!/usr/bin/env bash
# ============================================================================
# Test: stop-okr.sh 完成条件检查
# ============================================================================
set -euo pipefail

TEST_DIR=$(mktemp -d)
trap "rm -rf $TEST_DIR" EXIT

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  测试 stop-okr.sh 完成条件检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 初始化测试仓库
cd "$TEST_DIR"
git init -q
git config user.email "test@example.com"
git config user.name "Test"

# 找到 engine 根目录和 stop-okr.sh 路径
ENGINE_ROOT=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || echo "/home/xx/perfect21/cecelia/engine")
STOP_OKR="$ENGINE_ROOT/hooks/stop-okr.sh"

if [[ ! -f "$STOP_OKR" ]]; then
    echo "❌ stop-okr.sh 不存在: $STOP_OKR"
    exit 1
fi

# ===== Test 1: 没有 .okr-mode 文件 =====
echo "Test 1: 没有 .okr-mode 文件"
if bash "$STOP_OKR" 2>/dev/null; then
    echo "  ✅ 正确返回 exit 0"
else
    echo "  ❌ 应该返回 exit 0"
    exit 1
fi
echo ""

# ===== Test 2: .okr-mode 不是 okr 模式 =====
echo "Test 2: .okr-mode 不是 okr 模式"
echo "dev" > .okr-mode
if bash "$STOP_OKR" 2>/dev/null; then
    echo "  ✅ 正确返回 exit 0"
else
    echo "  ❌ 应该返回 exit 0"
    exit 1
fi
rm .okr-mode
echo ""

# ===== Test 3: Feature 未创建 =====
echo "Test 3: Feature 未创建"
cat > .okr-mode << 'EOF'
okr
kr_id: KR-001
feature_id: (待填)
task_ids: (待填)
prd_ids: (待填)
dod_ids: (待填)
kr_updated: false
EOF

if bash "$STOP_OKR" 2>/dev/null; then
    echo "  ❌ 应该返回 exit 2"
    exit 1
else
    EXIT_CODE=$?
    if [[ "$EXIT_CODE" == "2" ]]; then
        echo "  ✅ 正确返回 exit 2（阻止会话结束）"
    else
        echo "  ❌ 应该返回 exit 2，实际返回 $EXIT_CODE"
        exit 1
    fi
fi
echo ""

# ===== Test 4: Task 未创建 =====
echo "Test 4: Task 未创建"
cat > .okr-mode << 'EOF'
okr
kr_id: KR-001
feature_id: F-001
task_ids: (待填)
prd_ids: (待填)
dod_ids: (待填)
kr_updated: false
EOF

if bash "$STOP_OKR" 2>/dev/null; then
    echo "  ❌ 应该返回 exit 2"
    exit 1
else
    EXIT_CODE=$?
    if [[ "$EXIT_CODE" == "2" ]]; then
        echo "  ✅ 正确返回 exit 2（阻止会话结束）"
    else
        echo "  ❌ 应该返回 exit 2，实际返回 $EXIT_CODE"
        exit 1
    fi
fi
echo ""

# ===== Test 5: PRD 未写入 =====
echo "Test 5: PRD 未写入"
cat > .okr-mode << 'EOF'
okr
kr_id: KR-001
feature_id: F-001
task_ids: T-001 T-002
prd_ids: (待填)
dod_ids: (待填)
kr_updated: false
EOF

if bash "$STOP_OKR" 2>/dev/null; then
    echo "  ❌ 应该返回 exit 2"
    exit 1
else
    EXIT_CODE=$?
    if [[ "$EXIT_CODE" == "2" ]]; then
        echo "  ✅ 正确返回 exit 2（阻止会话结束）"
    else
        echo "  ❌ 应该返回 exit 2，实际返回 $EXIT_CODE"
        exit 1
    fi
fi
echo ""

# ===== Test 6: DoD 草稿未写入 =====
echo "Test 6: DoD 草稿未写入"
cat > .okr-mode << 'EOF'
okr
kr_id: KR-001
feature_id: F-001
task_ids: T-001 T-002
prd_ids: PRD-001 PRD-002
dod_ids: (待填)
kr_updated: false
EOF

if bash "$STOP_OKR" 2>/dev/null; then
    echo "  ❌ 应该返回 exit 2"
    exit 1
else
    EXIT_CODE=$?
    if [[ "$EXIT_CODE" == "2" ]]; then
        echo "  ✅ 正确返回 exit 2（阻止会话结束）"
    else
        echo "  ❌ 应该返回 exit 2，实际返回 $EXIT_CODE"
        exit 1
    fi
fi
echo ""

# ===== Test 7: KR 状态未更新 =====
echo "Test 7: KR 状态未更新"
cat > .okr-mode << 'EOF'
okr
kr_id: KR-001
feature_id: F-001
task_ids: T-001 T-002
prd_ids: PRD-001 PRD-002
dod_ids: DOD-001 DOD-002
kr_updated: false
EOF

if bash "$STOP_OKR" 2>/dev/null; then
    echo "  ❌ 应该返回 exit 2"
    exit 1
else
    EXIT_CODE=$?
    if [[ "$EXIT_CODE" == "2" ]]; then
        echo "  ✅ 正确返回 exit 2（阻止会话结束）"
    else
        echo "  ❌ 应该返回 exit 2，实际返回 $EXIT_CODE"
        exit 1
    fi
fi
echo ""

# ===== Test 8: 所有条件满足 =====
echo "Test 8: 所有条件满足"
cat > .okr-mode << 'EOF'
okr
kr_id: KR-001
feature_id: F-001
task_ids: T-001 T-002
prd_ids: PRD-001 PRD-002
dod_ids: DOD-001 DOD-002
kr_updated: true
EOF

if bash "$STOP_OKR" 2>/dev/null; then
    echo "  ✅ 正确返回 exit 0（允许会话结束）"
else
    echo "  ❌ 应该返回 exit 0"
    exit 1
fi

# 检查 .okr-mode 是否被删除
if [[ -f .okr-mode ]]; then
    echo "  ❌ .okr-mode 文件应该被删除"
    exit 1
else
    echo "  ✅ .okr-mode 文件已删除"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ 所有测试通过！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
