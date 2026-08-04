#!/usr/bin/env bash
#
# 回归测试：案卷式 GAN 会话续接降级（design doc §数据流3，决策 ba33fc68）
#
# 背景：dispatcher.js 会把同 run 同 role 最近一个终态成功 attempt 的
# provider_session_id 注入 bundle.inputs.resume_session_id；attempt-runner.cjs
# 只在 provider 匹配（都是 codex）时才把它转成 HARNESS_RESUME_SESSION_ID 环境变量，
# entrypoint.sh 用它拼 `codex exec resume <id>`。resume 本身可能失败（会话过期/
# 已被清理等）——这不该让整个 Attempt 判死：案卷（case_file）已经在同一份
# TaskBundle 里，改跑一次不带 resume 的全新会话是等价的降级路径。
#
# 测试策略：从 entrypoint.sh 摘出 is_codex_resume_error() 函数，喂样本 stdout，
# 验证它只在"看起来像会话/线程失效"的输出上返回真，普通输出/普通失败不误判。

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

FUNC_SRC=$(sed -n '/^is_codex_resume_error()/,/^}/p' "$ENTRYPOINT")
if [[ -z "$FUNC_SRC" ]]; then
  fail "entrypoint.sh 未定义 is_codex_resume_error() 函数（案卷式 GAN 会话续接降级应可测）"
  echo ""
  echo "结果: $TESTS_PASSED passed, $TESTS_FAILED failed"
  exit 1
fi
eval "$FUNC_SRC"

TMPDIR_T=$(mktemp -d)
trap 'rm -rf "$TMPDIR_T"' EXIT

# ── 用例 1：codex 报告找不到会话 → 必须识别为 resume 失败 ──
cat > "$TMPDIR_T/session-not-found.txt" <<'EOF'
{"type":"error","message":"thread not found"}
EOF
if is_codex_resume_error "$TMPDIR_T/session-not-found.txt"; then
  pass "用例1: 'thread not found' 识别为会话续接失败"
else
  fail "用例1: 'thread not found' 未被识别（降级不会触发）"
fi

# ── 用例 2：会话已过期的措辞变体 → 必须识别 ──
cat > "$TMPDIR_T/session-expired.txt" <<'EOF'
some normal jsonl noise before the error
Error: session has expired, please start a new one
EOF
if is_codex_resume_error "$TMPDIR_T/session-expired.txt"; then
  pass "用例2: 'session has expired' 识别为会话续接失败"
else
  fail "用例2: 'session has expired' 未被识别"
fi

# ── 用例 3：正常成功输出（没有任何会话失效信号）→ 不得误判 ──
cat > "$TMPDIR_T/normal-output.txt" <<'EOF'
{"type":"thread.started","thread_id":"thread-abc123"}
{"type":"item.completed","item":{"type":"agent_message","text":"done"}}
EOF
if is_codex_resume_error "$TMPDIR_T/normal-output.txt"; then
  fail "用例3: 正常输出被误判为会话续接失败"
else
  pass "用例3: 正常输出不触发降级"
fi

# ── 用例 4：普通网络/权限失败（与会话无关）→ 不得误判为 resume 失败 ──
# 这类失败应该走既有的 provider_exit 失败路径原样判死，不该被这条启发式
# 拦下来改判"降级成功候选"，否则会掩盖真实的基础设施故障。
cat > "$TMPDIR_T/unrelated-failure.txt" <<'EOF'
ERROR: rate limit exceeded, please retry later
EOF
if is_codex_resume_error "$TMPDIR_T/unrelated-failure.txt"; then
  fail "用例4: 与会话无关的失败（rate limit）被误判为会话续接失败"
else
  pass "用例4: 与会话无关的失败不触发降级误判"
fi

# ── 用例 5：agent 自然语言总结里恰好提到"session"字样但不是错误 → 不得误判 ──
# 同 B7 教训（entrypoint-error-keyword-scan.test.sh）：裸词全文匹配会把
# agent 复述 PRD/总结产出的自然语言误判成真实错误信号。
cat > "$TMPDIR_T/narrative-mentions-session.txt" <<'EOF'
本轮 reviewer 的结论：合同已覆盖 session 管理相关的边界场景，建议进入下一轮。
EOF
if is_codex_resume_error "$TMPDIR_T/narrative-mentions-session.txt"; then
  fail "用例5: 自然语言提及 session 但非错误被误判"
else
  pass "用例5: 自然语言提及 session 不触发降级误判"
fi

# ── 用例 6：文件不存在 → 视为非会话错误（不应该崩溃/误判）──
if is_codex_resume_error "$TMPDIR_T/does-not-exist.txt"; then
  fail "用例6: 不存在的 stdout 文件被误判为会话续接失败"
else
  pass "用例6: 不存在的 stdout 文件安全返回假"
fi

echo ""
echo "结果: $TESTS_PASSED passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]] || exit 1
