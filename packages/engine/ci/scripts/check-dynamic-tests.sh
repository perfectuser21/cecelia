#!/usr/bin/env bash
# ============================================================================
# check-dynamic-tests.sh — 动态测试门禁
# ============================================================================
# 规则 1：改了 hooks/ 或 lib/ 的 .sh 文件 → 对应测试必须包含 execSync/spawnSync
# 规则 2：[BEHAVIOR] DoD 条目至少 1 个引用 tests/*.test.ts
#
# CI 中运行，违反规则则 exit 1 阻止合并。
# ============================================================================

set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Dynamic Test Gate"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

FAILED=0
BASE_BRANCH="${1:-origin/main}"

# ===== 规则 1：改了 hook/lib 脚本必须有动态测试 =====
CHANGED_SH=$(git diff "$BASE_BRANCH" --name-only -- 'packages/engine/hooks/*.sh' 'packages/engine/lib/*.sh' 2>/dev/null || true)

if [[ -n "$CHANGED_SH" ]]; then
    echo "📋 检测到 hook/lib 脚本变更："
    echo "$CHANGED_SH" | sed 's/^/   /'
    echo ""

    # 找到变更的测试文件
    CHANGED_TESTS=$(git diff "$BASE_BRANCH" --name-only -- 'packages/engine/tests/**/*.test.ts' 2>/dev/null || true)

    if [[ -z "$CHANGED_TESTS" ]]; then
        echo "❌ 改了 hook/lib 脚本但没有对应测试变更"
        echo "   → 每次改动 .sh 文件必须同时更新或新增 .test.ts"
        FAILED=$((FAILED + 1))
    else
        # 检查测试文件是否包含动态执行
        HAS_DYNAMIC=false
        for f in $CHANGED_TESTS; do
            [[ -f "$f" ]] || continue
            if grep -qE "execSync|spawnSync" "$f" 2>/dev/null; then
                HAS_DYNAMIC=true
                echo "✅ 动态测试: $f"
            fi
        done

        if [[ "$HAS_DYNAMIC" != "true" ]]; then
            echo "❌ 测试文件不包含动态执行（execSync/spawnSync）"
            echo "   → 改了 hook/lib 脚本的测试必须真实执行脚本，不接受纯 readFileSync + toContain"
            FAILED=$((FAILED + 1))
        fi
    fi
else
    echo "⏭️  无 hook/lib 脚本变更，跳过动态测试检查"
fi

echo ""

# ===== 规则 2（仅 feat PR）：DoD 至少引用一个 .test.ts =====
# 读取 commit message 判断是否 feat
COMMIT_TYPE=$(git log "$BASE_BRANCH"..HEAD --format="%s" | head -1 | grep -oE "^(feat|fix|refactor|test|chore|docs)" || echo "unknown")

if [[ "$COMMIT_TYPE" == "feat" ]]; then
    # 搜索 task card 中的 DoD
    TASK_CARDS=$(git diff "$BASE_BRANCH" --name-only | grep -E "\.task-.*\.md$" || true)

    if [[ -n "$TASK_CARDS" ]]; then
        HAS_TEST_REF=false
        for tc in $TASK_CARDS; do
            [[ -f "$tc" ]] || continue
            if grep -qE "Test:.*tests/.*\.test\.ts" "$tc" 2>/dev/null; then
                HAS_TEST_REF=true
                echo "✅ DoD 引用测试文件: $tc"
            fi
        done

        if [[ "$HAS_TEST_REF" != "true" ]]; then
            echo "⚠️  feat PR 的 DoD 未引用 .test.ts 文件（建议但不阻塞）"
        fi
    fi
else
    echo "⏭️  非 feat PR（$COMMIT_TYPE），跳过 DoD 引用检查"
fi

echo ""

# ===== 结果 =====
if [[ $FAILED -gt 0 ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ❌ Dynamic Test Gate 失败 ($FAILED 个问题)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
else
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ✅ Dynamic Test Gate 通过"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi
