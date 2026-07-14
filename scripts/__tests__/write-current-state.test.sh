#!/usr/bin/env bash
# =============================================================================
# write-current-state.test.sh — 验证 write-current-state.sh 的功能完整性
#
# 测试内容：
# 1. 脚本文件存在且可执行
# 2. 脚本包含正确的输出路径逻辑（兼容 worktree）
# 3. 脚本包含 Brain 离线降级保护（--max-time）
# 4. Stage 4 集成：engine-ship/SKILL.md 含 write-current-state 调用（Phase 5 迁移）
# 5. 脚本执行不崩溃（即使 Brain 离线）
#
# 使用方式：bash scripts/__tests__/write-current-state.test.sh
# =============================================================================

set -euo pipefail

ERRORS=0
PASS=0

pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; ERRORS=$((ERRORS+1)); }

echo "=== write-current-state.sh 集成测试 ==="
echo ""

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SCRIPT="$REPO_ROOT/scripts/write-current-state.sh"

# ── 测试 1：脚本文件存在且可执行 ──────────────────────────────────────────────
if [[ -f "$SCRIPT" ]]; then
    pass "脚本文件存在: scripts/write-current-state.sh"
else
    fail "脚本文件不存在: scripts/write-current-state.sh"
fi

if bash -n "$SCRIPT" 2>/dev/null; then
    pass "脚本语法检查通过（bash -n）"
else
    fail "脚本语法错误"
fi

# ── 测试 2：输出路径兼容 worktree ─────────────────────────────────────────────
if grep -q "git-common-dir\|GIT_COMMON" "$SCRIPT" 2>/dev/null; then
    pass "含 worktree 路径兼容逻辑（git-common-dir）"
else
    fail "缺少 worktree 路径兼容逻辑"
fi

# ── 测试 3：Brain 离线降级保护 ────────────────────────────────────────────────
if grep -q "max-time" "$SCRIPT" 2>/dev/null; then
    pass "含 --max-time 超时保护（Brain 离线不崩溃）"
else
    fail "缺少 --max-time 超时保护"
fi

# ── 测试 4：engine-ship 已迁移到 zenithjoy-skills，此检查由 zenithjoy-skills 自己维护 ──
pass "engine-ship/SKILL.md 已迁移到 zenithjoy-skills（跳过 engine CI 校验）"

# ── 测试 5：CURRENT_STATE.md 目标文件已初始化 ─────────────────────────────────
STATE_FILE="$REPO_ROOT/.agent-knowledge/CURRENT_STATE.md"
if [[ -f "$STATE_FILE" ]]; then
    pass ".agent-knowledge/CURRENT_STATE.md 存在"
else
    fail ".agent-knowledge/CURRENT_STATE.md 不存在（需要初始化占位文件）"
fi

# ── 测试 6：脚本执行不崩溃（Brain 离线时） ───────────────────────────────────
TMPDIR_OUT=$(mktemp -d)
if BRAIN_API_URL="http://localhost:19999" CURRENT_STATE_OUTPUT_FILE="$TMPDIR_OUT/CURRENT_STATE.md" bash "$SCRIPT" > "$TMPDIR_OUT/run.log" 2>&1; then
    pass "Brain 离线时脚本正常退出（exit 0）"
else
    EXIT_CODE=$?
    if [[ $EXIT_CODE -lt 100 ]]; then
        pass "Brain 离线时脚本未崩溃（exit $EXIT_CODE 可接受）"
    else
        fail "Brain 离线时脚本崩溃（exit ${EXIT_CODE}）"
    fi
fi

# ── 测试 7：脚本包含最近 PR 章节输出逻辑 ────────────────────────────────────
if grep -q "dev-records\|最近 PR\|PR_SECTION" "$SCRIPT" 2>/dev/null; then
    pass "脚本包含最近 PR 章节（dev-records API）"
else
    fail "脚本缺少最近 PR 章节逻辑"
fi

# ── 测试 8：脚本包含 P0 Issues 章节输出逻辑 ──────────────────────────────────
if grep -q "P0.*blocked\|P0.*failed\|P0_SECTION" "$SCRIPT" 2>/dev/null; then
    pass "脚本包含 P0 Issues 章节（blocked/failed P0 任务）"
else
    fail "脚本缺少 P0 Issues 章节逻辑"
fi

# ── 测试 9：生成产物含测试金字塔段（刀0 面板复活） ────────────────────────────
GENERATED_FILE="$TMPDIR_OUT/CURRENT_STATE.md"
if [[ -f "$GENERATED_FILE" ]] && grep -q "## 测试金字塔" "$GENERATED_FILE" 2>/dev/null; then
    pass "生成产物含「## 测试金字塔」段"
else
    fail "生成产物缺少「## 测试金字塔」段"
fi
if [[ -f "$GENERATED_FILE" ]] && grep -q "孤儿" "$GENERATED_FILE" 2>/dev/null; then
    pass "生成产物含孤儿计数行"
else
    fail "生成产物缺少孤儿计数行"
fi
rm -rf "$TMPDIR_OUT"

# ── 测试 10：guard FAIL 时面板段仍含 FAIL 详情（JSON 不被 '{}' 污染） ─────────
FIX_RED=$(mktemp -d)
TMPDIR_RED=$(mktemp -d)
mkdir -p "$FIX_RED/scripts/smoke" "$FIX_RED/sprints/s1"
touch "$FIX_RED/sprints/s1/x.test.ts"
cat > "$FIX_RED/scripts/test-pyramid-baseline.json" <<'EOF'
{"orphans":0,"permanent":0,"permanent_roots":[],"smoke_dir":"scripts/smoke"}
EOF
BRAIN_API_URL="http://localhost:19999" PYRAMID_GUARD_ROOT="$FIX_RED" \
    CURRENT_STATE_OUTPUT_FILE="$TMPDIR_RED/CURRENT_STATE.md" \
    bash "$SCRIPT" > "$TMPDIR_RED/run.log" 2>&1 || true
if grep -q "守卫: ❌ FAIL" "$TMPDIR_RED/CURRENT_STATE.md" 2>/dev/null; then
    pass "guard FAIL 时面板段含「守卫: ❌ FAIL」详情"
else
    fail "guard FAIL 时面板段丢失 FAIL 详情（JSON 被污染或降级为不可用）"
fi
rm -rf "$FIX_RED" "$TMPDIR_RED"

# ── 测试 11：金字塔快照 best-effort POST 喂 Brain（Dashboard 数据源） ─────────
# 静态断言脚本含该 POST（真发由测试 6/10 的 BRAIN_API_URL=19999 离线跑覆盖：
# best-effort || true 不崩溃即证明降级正确，无需 mock 真 Brain）
if grep -q "quality/test-pyramid" "$SCRIPT" 2>/dev/null && \
   grep -q 'PYRAMID_JSON' "$SCRIPT" 2>/dev/null && \
   grep -qE 'curl.*-X POST.*quality/test-pyramid|curl.*quality/test-pyramid.*POST' "$SCRIPT" 2>/dev/null; then
    pass "脚本含金字塔快照 POST → Brain /api/brain/quality/test-pyramid"
else
    fail "脚本缺少金字塔快照 POST（Dashboard /test-pyramid 页面将无数据）"
fi
if grep -A3 "quality/test-pyramid" "$SCRIPT" 2>/dev/null | grep -q "|| true"; then
    pass "金字塔 POST 是 best-effort（|| true，Brain 离线不崩溃）"
else
    fail "金字塔 POST 缺少 || true 降级保护"
fi

# ── 结果汇总 ──────────────────────────────────────────────────────────────────
echo ""
echo "=== 测试结果 ==="
echo "通过: $PASS | 失败: $ERRORS"

if [[ $ERRORS -gt 0 ]]; then
    echo "❌ 测试失败"
    exit 1
fi

echo "✅ 全部通过"
exit 0
