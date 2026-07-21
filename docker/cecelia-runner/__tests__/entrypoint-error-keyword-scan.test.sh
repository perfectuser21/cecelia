#!/usr/bin/env bash
#
# 回归测试：entrypoint.sh B7 错误关键词扫描不得误杀正常任务
#
# Bug（2026-07-21，任务 0f7dd3d7 / c864b0c1 两例实锤）：
#   B7 用裸词全文 grep（401|unauthorized|usage limit|stream error），
#   agent 在自然语言总结里提到这些词（如"治理 usage limit 场景"的任务 PRD 复述）
#   → exit=0 被覆写成 1 → orphan-guard 重试超限 → 好任务被判 terminal failed。
#
# 期望行为：只有"真实错误行"（含 ERROR/FATAL 标记的行）里出现关键词才触发覆写。
#
# 测试策略：从 entrypoint.sh 摘出 scan_error_keywords 函数，在沙箱中喂样本 stdout。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENTRYPOINT="$SCRIPT_DIR/../entrypoint.sh"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

pass() { echo -e "${GREEN}✓${NC} $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo -e "${RED}✗${NC} $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

# 摘出 scan_error_keywords() 函数定义（修复后 entrypoint 必须提供此函数）
FUNC_SRC=$(sed -n '/^scan_error_keywords()/,/^}/p' "$ENTRYPOINT")
if [[ -z "$FUNC_SRC" ]]; then
  fail "entrypoint.sh 未定义 scan_error_keywords() 函数（B7 应重构为可测函数）"
  echo ""
  echo "结果: $TESTS_PASSED passed, $TESTS_FAILED failed"
  exit 1
fi
eval "$FUNC_SRC"

TMPDIR_T=$(mktemp -d)
trap 'rm -rf "$TMPDIR_T"' EXIT

# ── 用例 1：agent 自然语言总结提到敏感词 → 不得触发 ──
cat > "$TMPDIR_T/narrative.txt" <<'EOF'
本任务的目标是治理配额撞墙场景，包括 usage limit 打满、账号返回 401 unauthorized
等情况的自动换号续接。已按 PRD 完成刀1账本改造并开出 PR。
所以这条 sprint 还没到 merge/report 终态；目前状态是"代码完成并开 PR，等待 CI 与 review gate"。
EOF
if scan_error_keywords "$TMPDIR_T/narrative.txt"; then
  fail "用例1: 自然语言提及 usage limit/401 被误判为错误（误杀复现）"
else
  pass "用例1: 自然语言提及敏感词不触发覆写"
fi

# ── 用例 2：codex CLI 真实 401 错误行 → 必须触发 ──
cat > "$TMPDIR_T/real-auth.txt" <<'EOF'
some normal output
ERROR: Your access token could not be refreshed because your refresh token was already used (401 unauthorized).
EOF
if scan_error_keywords "$TMPDIR_T/real-auth.txt"; then
  pass "用例2: ERROR 行内 401 触发覆写"
else
  fail "用例2: 真实 401 错误行未被识别（守卫失灵）"
fi

# ── 用例 3：codex runtime 带时间戳的 ERROR 行 → 必须触发 ──
cat > "$TMPDIR_T/real-stream.txt" <<'EOF'
2026-07-21T08:52:50.5050896Z ERROR codex_core::client: stream error: connection reset
EOF
if scan_error_keywords "$TMPDIR_T/real-stream.txt"; then
  pass "用例3: 时间戳 ERROR 行内 stream error 触发覆写"
else
  fail "用例3: runtime stream error 未被识别（守卫失灵）"
fi

# ── 用例 4：正文里裸提 stream error 字样 → 不得触发 ──
cat > "$TMPDIR_T/prose-stream.txt" <<'EOF'
排查手册：遇到 stream error 时应先检查网络，再看 usage limit 是否打满。
EOF
if scan_error_keywords "$TMPDIR_T/prose-stream.txt"; then
  fail "用例4: 正文裸提 stream error 被误判"
else
  pass "用例4: 正文裸提 stream error 不触发"
fi

echo ""
echo "结果: $TESTS_PASSED passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]] || exit 1
