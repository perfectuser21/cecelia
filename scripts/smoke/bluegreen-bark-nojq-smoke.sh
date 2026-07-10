#!/usr/bin/env bash
# bluegreen-bark-nojq-smoke.sh — 回归守卫：bluegreen.sh 在无 jq 的 PATH 下不 exit 非零
#
# 断言：
#   A no-jq-no-python3   : PATH 只含 /usr/bin（无 jq），send_bark 调用退 0
#   B no-jq-with-python3 : PATH 含 python3 但无 jq，_url_encode 走 python3 兜底退 0
#   C both-missing       : PATH 完全不含 jq 也不含 python3，send_bark 退 0（原样传 ASCII）
#
# 根因：bluegreen.sh:21（原版）直接 `jq -sRr @uri`，容器内无 jq → set -e → exit 127
# 参见 Gate3 2026-07-10 连败日志（drain 正常等待后倒在 jq: command not found）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BLUEGREEN="$ROOT_DIR/scripts/lib/bluegreen.sh"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
FAILED=0
pass() { echo -e "${GREEN}[OK]${NC} $1"; }
fail() { echo -e "${RED}[X]${NC} $1"; FAILED=$((FAILED + 1)); }

echo "=== bluegreen.sh bark non-fatal（无 jq 依赖）smoke ==="
echo ""

[[ -f "$BLUEGREEN" ]] && pass "bluegreen.sh 存在" || { fail "bluegreen.sh 不存在（$BLUEGREEN）"; exit 1; }
echo ""

# ── 共用测试函数 ──
# run_bark_test <label> <PATH_override>
# 在子进程中：source bluegreen.sh + 调 send_bark，断言退 0
run_bark_test() {
  local label="$1"
  local path_override="$2"
  local out
  out=$(PATH="$path_override" bash -c "
    set -uo pipefail
    # 不配 BARK_TOKEN → 直接走「未配 BARK_TOKEN，跳过推送」分支
    unset BARK_TOKEN HOME 2>/dev/null || true
    HOME=/nonexistent
    source '$BLUEGREEN'
    send_bark 'smoke-test-msg'
  " 2>&1)
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    pass "${label}：send_bark 退 0（non-fatal）"
  else
    fail "${label}：send_bark 退 $rc（fatal！）"
    echo "    输出: $out"
  fi
}

# ── A: 无 jq、无 python3（PATH 仅含基础工具） ──
echo "[A] no-jq / no-python3"
# 找一个确实没有 jq 但有 bash/echo 的 PATH
SAFE_PATH="/bin:/usr/bin"
# 确认 jq 不在这个 PATH 里
if PATH="$SAFE_PATH" command -v jq >/dev/null 2>&1; then
  echo "  [skip] jq 也在 /bin 或 /usr/bin，跳过 A（环境里 jq 无法剔除）"
else
  run_bark_test "no-jq/no-python3" "$SAFE_PATH"
fi
echo ""

# ── B: 有 python3，无 jq ──
echo "[B] python3-fallback（有 python3，无 jq）"
# 找 python3 的真实路径
PYTHON3_PATH="$(command -v python3 2>/dev/null || true)"
if [[ -z "$PYTHON3_PATH" ]]; then
  echo "  [skip] 当前机器无 python3，跳过 B"
else
  PY_DIR="$(dirname "$PYTHON3_PATH")"
  # 构造一个含 python3 但剔除 jq 的 PATH
  NO_JQ_PATH="$PY_DIR:/bin:/usr/bin"
  if PATH="$NO_JQ_PATH" command -v jq >/dev/null 2>&1; then
    echo "  [skip] 无法从 PATH 剔除 jq，跳过 B"
  else
    run_bark_test "python3-fallback" "$NO_JQ_PATH"
  fi
fi
echo ""

# ── C: 直接用真实 PATH（验证有无 jq 均不 fatal，这是主路径） ──
echo "[C] real-PATH（验证当前环境不 fatal）"
# 无论当前机器有没有 jq，send_bark 都必须不 fatal
out=$(bash -c "
  set -uo pipefail
  unset BARK_TOKEN HOME 2>/dev/null || true
  HOME=/nonexistent
  source '$BLUEGREEN'
  send_bark 'smoke-real-path'
" 2>&1)
rc=$?
if [[ $rc -eq 0 ]]; then
  pass "real-PATH：send_bark 退 0（non-fatal，当前 PATH=$(command -v jq 2>/dev/null || echo '无jq')）"
else
  fail "real-PATH：send_bark 退 $rc"
  echo "    输出: $out"
fi
echo ""

# ── D: source 本身不 fatal（set -uo pipefail 下） ──
echo "[D] source 无副作用"
out=$(bash -c "
  set -euo pipefail
  source '$BLUEGREEN'
  echo OK
" 2>&1)
rc=$?
[[ $rc -eq 0 ]] && [[ "$out" == *"OK"* ]] \
  && pass "set -euo pipefail 下 source bluegreen.sh 无副作用退 0" \
  || { fail "source bluegreen.sh 在 set -e 下 exit $rc"; echo "    输出: $out"; }
echo ""

echo "========================================"
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}BLUEGREEN_BARK_NOJQ_SMOKE_OK${NC} — 全绿"
  exit 0
else
  echo -e "${RED}BLUEGREEN_BARK_NOJQ_SMOKE_FAIL${NC} — ${FAILED} 项红"
  exit 1
fi
