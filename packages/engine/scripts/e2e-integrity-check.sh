#!/usr/bin/env bash
# e2e-integrity-check.sh — Engine Pipeline E2E 完整性检测
#
# 在不依赖 Brain 服务、无需真实 push 的情况下，
# 检测 Engine pipeline 关键组件的完整性。
#
# 每项输出 PASS: <说明> 或 FAIL: <原因>
# 整体 exit code 反映所有检测项目通过状态（有 FAIL 则 exit 1）
#
# 用法：
#   bash packages/engine/scripts/e2e-integrity-check.sh

set -uo pipefail

PASS_COUNT=0
FAIL_COUNT=0

_pass() { echo "PASS: $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
_fail() { echo "FAIL: $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

# 定位项目根目录（从 packages/engine/scripts/ 上溯三级到 monorepo 根）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "=== Engine E2E Integrity Check ==="
echo "项目根目录: $PROJECT_ROOT"
echo ""

# ─── 检测 1：git worktree 能力 ──────────────────────────────────
if git -C "$PROJECT_ROOT" worktree list >/dev/null 2>&1; then
    WT_COUNT=$(git -C "$PROJECT_ROOT" worktree list 2>/dev/null | wc -l | tr -d ' ')
    _pass "git worktree 可用（当前 ${WT_COUNT} 个 worktree）"
else
    _fail "git worktree list 命令失败（git 版本或权限问题）"
fi

# ─── 检测 2：hooks 目录下所有 .sh 文件可执行性 ─────────────────
HOOKS_DIR="$PROJECT_ROOT/packages/engine/hooks"
if [[ -d "$HOOKS_DIR" ]]; then
    NON_EXEC=()
    while IFS= read -r hook_file; do
        [[ -x "$hook_file" ]] || NON_EXEC+=("$(basename "$hook_file")")
    done < <(find "$HOOKS_DIR" -name "*.sh" -type f 2>/dev/null)
    if [[ ${#NON_EXEC[@]} -eq 0 ]]; then
        HOOK_COUNT=$(find "$HOOKS_DIR" -name "*.sh" -type f 2>/dev/null | wc -l | tr -d ' ')
        _pass "hooks/ 目录下所有 ${HOOK_COUNT} 个 .sh 文件均可执行"
    else
        _fail "以下 hook 文件不可执行（缺少 chmod +x）：${NON_EXEC[*]}"
    fi
else
    _fail "hooks 目录不存在：$HOOKS_DIR"
fi

# ─── 检测 3：DoD 格式校验逻辑（[ ] 检测）──────────────────────
DOD_CHECK_SCRIPT="$PROJECT_ROOT/packages/engine/ci/scripts/check-learning-format.sh"
if [[ -f "$DOD_CHECK_SCRIPT" ]]; then
    CONTENT=$(cat "$DOD_CHECK_SCRIPT")
    if echo "$CONTENT" | grep -q '[ ]'; then
        _pass "check-learning-format.sh 包含 '- [ ]' 检测逻辑"
    else
        _fail "check-learning-format.sh 未包含 '- [ ]' 检测逻辑"
    fi
else
    _fail "DoD/Learning 格式校验脚本不存在：$DOD_CHECK_SCRIPT"
fi

# ─── 检测 4：Learning 格式校验（### 根本原因 检测）─────────────
if [[ -f "$DOD_CHECK_SCRIPT" ]]; then
    CONTENT=$(cat "$DOD_CHECK_SCRIPT")
    if echo "$CONTENT" | grep -q '根本原因'; then
        _pass "check-learning-format.sh 包含 '### 根本原因' 章节检测"
    else
        _fail "check-learning-format.sh 未包含 '### 根本原因' 章节检测"
    fi
else
    _fail "Learning 格式校验脚本不存在（跳过根本原因检测）"
fi

# ─── 检测 5：branch-protect 核心逻辑（PRD/DoD 文件检测）────────
BRANCH_PROTECT="$PROJECT_ROOT/packages/engine/hooks/branch-protect.sh"
if [[ -f "$BRANCH_PROTECT" ]]; then
    CONTENT=$(cat "$BRANCH_PROTECT")
    if echo "$CONTENT" | grep -qE 'DoD|dod|\[ \]|unchecked'; then
        _pass "branch-protect.sh 包含 DoD/unchecked 检测逻辑"
    else
        _fail "branch-protect.sh 未包含 DoD/unchecked 检测逻辑"
    fi
else
    _fail "branch-protect.sh 不存在：$BRANCH_PROTECT"
fi

# ─── 检测 6：cwd-as-key 架构（v19.0.0，替代老的 _collect_search_dirs 扫描）──
# 老设计要求 stop-dev.sh 扫所有 worktree 找 .dev-lock → 组合爆炸 99 commit 不收敛。
# 新设计：只看 cwd → worktree → .dev-mode.<branch> 存在性。必须检出 CLAUDE_HOOK_CWD。
STOP_DEV="$PROJECT_ROOT/packages/engine/hooks/stop-dev.sh"
if [[ -f "$STOP_DEV" ]]; then
    CONTENT=$(cat "$STOP_DEV")
    if echo "$CONTENT" | grep -q 'CLAUDE_HOOK_CWD'; then
        _pass "stop-dev.sh 使用 cwd-as-key 架构（v19.0.0 CLAUDE_HOOK_CWD）"
    else
        _fail "stop-dev.sh 未使用 cwd-as-key 架构（缺 CLAUDE_HOOK_CWD 导入）"
    fi
else
    _fail "stop-dev.sh 不存在：$STOP_DEV"
fi

# ─── 检测 7：manual: 命令白名单校验脚本存在 ────────────────────
WHITELIST_SCRIPT="$PROJECT_ROOT/scripts/devgate/check-manual-cmd-whitelist.cjs"
if [[ -f "$WHITELIST_SCRIPT" ]]; then
    CONTENT=$(cat "$WHITELIST_SCRIPT")
    if echo "$CONTENT" | grep -q 'ALLOWED_COMMANDS'; then
        _pass "check-manual-cmd-whitelist.cjs 存在且定义了 ALLOWED_COMMANDS"
    else
        _fail "check-manual-cmd-whitelist.cjs 存在但未定义 ALLOWED_COMMANDS"
    fi
else
    _fail "manual: 命令白名单校验脚本不存在：$WHITELIST_SCRIPT"
fi

# ─── 检测 8：pre-push.sh 包含失败提示 ─────────────────────────
PRE_PUSH="$PROJECT_ROOT/packages/engine/hooks/pre-push.sh"
if [[ -f "$PRE_PUSH" ]]; then
    CONTENT=$(cat "$PRE_PUSH")
    if echo "$CONTENT" | grep -qE 'FAIL|ERROR|失败'; then
        _pass "pre-push.sh 包含失败提示关键词（FAIL/ERROR/失败）"
    else
        _fail "pre-push.sh 未包含失败提示关键词"
    fi
else
    _fail "pre-push.sh 不存在：$PRE_PUSH"
fi

# ─── 检测 9：quickcheck.sh DoD 守卫（本地拦截 DoD 未勾选）───────
# 根因：harness-contract-lint CI 因 DoD [ ] 未勾选失败是可预防的本地错误
QUICKCHECK="$PROJECT_ROOT/scripts/quickcheck.sh"
if [[ -f "$QUICKCHECK" ]]; then
    CONTENT=$(cat "$QUICKCHECK")
    if echo "$CONTENT" | grep -q 'DoD 未勾选'; then
        _pass "quickcheck.sh 包含 DoD 守卫（本地拦截未勾选条目）"
    else
        _fail "quickcheck.sh 未包含 DoD 守卫 — harness-contract-lint CI 失败无法本地拦截"
    fi
else
    _fail "quickcheck.sh 不存在：$QUICKCHECK"
fi

# ─── 汇总 ─────────────────────────────────────────────────────────
echo ""
echo "=== 检测结果汇总 ==="
echo "PASS: ${PASS_COUNT}  FAIL: ${FAIL_COUNT}"

if [[ ${FAIL_COUNT} -gt 0 ]]; then
    echo "❌ Engine E2E Integrity Check 未通过（${FAIL_COUNT} 项失败）"
    exit 1
fi

echo "✅ Engine E2E Integrity Check 全部通过（${PASS_COUNT} 项）"
exit 0
