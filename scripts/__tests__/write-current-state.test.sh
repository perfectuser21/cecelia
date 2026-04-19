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

# ── 测试 4：Stage 4 集成 ───────────────────────────────────────────────────────
SHIP_MD="$REPO_ROOT/packages/engine/skills/engine-ship/SKILL.md"
if [[ -f "$SHIP_MD" ]]; then
    if grep -q "write-current-state.sh" "$SHIP_MD" 2>/dev/null; then
        pass "engine-ship/SKILL.md 已集成 write-current-state.sh（Phase 5 迁移自 04-ship.md）"
    else
        fail "engine-ship/SKILL.md 未集成 write-current-state.sh"
    fi
else
    fail "engine-ship/SKILL.md 不存在: $SHIP_MD"
fi

# ── 测试 5：CURRENT_STATE.md 目标文件已初始化 ─────────────────────────────────
STATE_FILE="$REPO_ROOT/.agent-knowledge/CURRENT_STATE.md"
if [[ -f "$STATE_FILE" ]]; then
    pass ".agent-knowledge/CURRENT_STATE.md 存在"
else
    fail ".agent-knowledge/CURRENT_STATE.md 不存在（需要初始化占位文件）"
fi

# ── 测试 6：脚本执行不崩溃（Brain 离线时） ───────────────────────────────────
TMPDIR_OUT=$(mktemp -d)
if BRAIN_API_URL="http://localhost:19999" bash "$SCRIPT" > "$TMPDIR_OUT/run.log" 2>&1; then
    pass "Brain 离线时脚本正常退出（exit 0）"
else
    EXIT_CODE=$?
    if [[ $EXIT_CODE -lt 100 ]]; then
        pass "Brain 离线时脚本未崩溃（exit $EXIT_CODE 可接受）"
    else
        fail "Brain 离线时脚本崩溃（exit ${EXIT_CODE}）"
    fi
fi
rm -rf "$TMPDIR_OUT"

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
