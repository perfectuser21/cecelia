#!/usr/bin/env bash
# dedup-temporal-check.sh — 撞车检查时间盲区修复合同测试
#
# 测试矩阵：
#   场景B: merged PR 有命中 → 修复后应 exit 1 含 [COLLISION]（Red阶段FAIL）
#   场景C: merged PR 无命中 → exit 0 放行
#   场景D: SKILL.md 含"复现或退场"铁律 ≥4条（Red阶段FAIL）
#   场景E: 版本号一致性（package.json vs VERSION vs SKILL.md frontmatter）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

WORKTREE_MANAGE="$PROJECT_ROOT/skills/dev/scripts/worktree-manage.sh"
COLLISION_CHECK="$SCRIPT_DIR/run-collision-check.sh"
SKILL_MD="$PROJECT_ROOT/skills/dev/SKILL.md"
PKG_JSON="$PROJECT_ROOT/package.json"
VERSION_FILE="$PROJECT_ROOT/VERSION"

PASSED=0
FAILED=0

pass() { echo "  ✅ $1"; PASSED=$((PASSED + 1)); }
fail() { echo "  ❌ $1"; FAILED=$((FAILED + 1)); }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  dedup-temporal-check — 撞车检查时间盲区 合同测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─────────────────────────────────────────────────────
# 准备 mock 目录
# ─────────────────────────────────────────────────────
MOCK_DIR=$(mktemp -d)
trap 'rm -rf "$MOCK_DIR"' EXIT

# ─────────────────────────────────────────────────────
# 场景 B: merged PR 有命中 → 应 exit 1 含 [COLLISION]
# ─────────────────────────────────────────────────────
echo "场景 B: merged PR 有命中 → 撞车检查应阻止（exit 1 + [COLLISION]）"

# 创建 mock gh — 模拟 "open PR 无结果，merged PR 有结果"
cat > "$MOCK_DIR/gh" << 'MOCK_GH'
#!/usr/bin/env bash
# mock gh — 撞车检查 B 场景：open 无，merged 有
ARGS="$*"
if echo "$ARGS" | grep -q "state merged"; then
    # 返回近7天内的 merged PR
    SEVEN_DAYS_AGO=$(python3 -c "from datetime import datetime, timezone, timedelta; print((datetime.now(timezone.utc) - timedelta(days=3)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
    echo '[{"number":42,"title":"fix-dedup-temporal","mergedAt":"'"$SEVEN_DAYS_AGO"'","headRefName":"cp-07170755-fix-dedup-temporal"}]'
elif echo "$ARGS" | grep -q "state open"; then
    echo '[]'
else
    echo '[]'
fi
MOCK_GH
chmod +x "$MOCK_DIR/gh"

if [[ ! -f "$COLLISION_CHECK" ]]; then
    fail "场景B: run-collision-check.sh 不存在（需先创建）"
else
    output=$(env PATH="$MOCK_DIR:$PATH" bash "$COLLISION_CHECK" "fix-dedup-temporal" 2>&1) || exit_code=$?
    exit_code=${exit_code:-0}
    if [[ $exit_code -ne 0 ]] && echo "$output" | grep -q "\[COLLISION\]"; then
        pass "场景B: merged PR 有命中 → exit $exit_code 且含 [COLLISION]"
    else
        fail "场景B: 期望 exit 1 且含 [COLLISION]，实际 exit=$exit_code output='$output'"
    fi
fi

echo ""

# ─────────────────────────────────────────────────────
# 场景 C: merged PR 无命中 → exit 0 放行
# ─────────────────────────────────────────────────────
echo "场景 C: merged PR 无命中 → 应放行（exit 0）"

# 创建 mock gh — open 无，merged 也无
cat > "$MOCK_DIR/gh" << 'MOCK_GH'
#!/usr/bin/env bash
# mock gh — 场景C：open 无，merged 也无
echo '[]'
MOCK_GH
chmod +x "$MOCK_DIR/gh"

if [[ ! -f "$COLLISION_CHECK" ]]; then
    fail "场景C: run-collision-check.sh 不存在"
else
    output=$(env PATH="$MOCK_DIR:$PATH" bash "$COLLISION_CHECK" "some-unrelated-task" 2>&1) || exit_code=$?
    exit_code=${exit_code:-0}
    if [[ $exit_code -eq 0 ]]; then
        pass "场景C: merged PR 无命中 → exit 0 放行"
    else
        fail "场景C: 期望 exit 0，实际 exit=$exit_code output='$output'"
    fi
fi

echo ""

# ─────────────────────────────────────────────────────
# 场景 D: SKILL.md 含"复现或退场"铁律 ≥4条
# ─────────────────────────────────────────────────────
echo "场景 D: SKILL.md 含"复现或退场"铁律 ≥4条"

if [[ ! -f "$SKILL_MD" ]]; then
    fail "场景D: SKILL.md 不存在"
else
    # 计算"复现或退场"相关条目数量
    # 铁律每条以数字+点或破折号开头，包含关键词 test/退场/禁止/豁免/留痕
    count=$(grep -c "复现或退场\|不红.*退场\|退场铁律\|completed.duplicate.\|obsolete.*不重复" "$SKILL_MD" 2>/dev/null; true)
    count=$(echo "$count" | head -1 | tr -d '[:space:]')
    count="${count:-0}"
    if [[ "$count" -ge 4 ]]; then
        pass "场景D: SKILL.md 含复现或退场铁律 ${count} 条（≥4）"
    else
        fail "场景D: SKILL.md 含复现或退场铁律仅 ${count} 条（需 ≥4）"
    fi
fi

echo ""

# ─────────────────────────────────────────────────────
# 场景 E: 版本号一致性（package.json vs VERSION vs SKILL.md）
# ─────────────────────────────────────────────────────
echo "场景 E: 版本号一致性"

pkg_version=$(python3 -c "import json; d=json.load(open('$PKG_JSON')); print(d['version'])" 2>/dev/null || echo "")
file_version=$(cat "$VERSION_FILE" 2>/dev/null | tr -d '[:space:]' || echo "")
skill_version=$(grep "^version:" "$SKILL_MD" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '"' || echo "")

echo "  package.json version: $pkg_version"
echo "  VERSION file:         $file_version"
echo "  SKILL.md version:     $skill_version"

if [[ -z "$pkg_version" ]]; then
    fail "场景E: 无法读取 package.json version"
elif [[ -z "$file_version" ]]; then
    fail "场景E: 无法读取 VERSION file"
elif [[ "$pkg_version" != "$file_version" ]]; then
    fail "场景E: package.json ($pkg_version) ≠ VERSION ($file_version)"
elif [[ -n "$skill_version" && "$pkg_version" != "$skill_version" ]]; then
    fail "场景E: package.json ($pkg_version) ≠ SKILL.md version ($skill_version)"
else
    pass "场景E: 版本号一致 ($pkg_version)"
fi

echo ""

# ─────────────────────────────────────────────────────
# 汇总
# ─────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  结果: PASS=$PASSED, FAIL=$FAILED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
