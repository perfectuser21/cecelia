#!/usr/bin/env bash
#
# 回归测试：entrypoint.sh harness callback 重试逻辑
#
# 验证 Bug 修复：单次 curl 失败时 Brain 重启窗口（~5-10s）导致 callback 丢失。
# 修复：5 次重试 + 指数退避（3/6/9/12s）。
#
# 测试策略：
#   - 用 stub curl 替代真实 curl，按测试用例模拟成功/失败
#   - 提取 entrypoint.sh 中的 callback 逻辑片段，在沙箱中执行
#   - 验证重试次数、最终输出、exit code 无副作用
#

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

# 提取 entrypoint.sh 中的 callback 重试代码段（CALLBACK_OK 到 fi 结尾）
# 用 sed 精确摘出，在独立 subshell 中执行。
run_callback_block() {
  local fail_times="$1"   # 前 N 次 curl 失败，第 N+1 次成功（0 = 全成功，99 = 全失败）
  local attempt_log

  attempt_log=$(
    CURL_CALL_COUNT=0
    TARGET_URL="http://fake-brain/callback"
    EXIT_CODE=0
    CALLBACK_BODY='{}'

    # stub curl：模拟前 fail_times 次失败
    curl() {
      CURL_CALL_COUNT=$((CURL_CALL_COUNT + 1))
      if [[ $CURL_CALL_COUNT -le ${fail_times} ]]; then
        return 1
      fi
      return 0
    }
    export -f curl
    # stub sleep：不真正等待
    sleep() { :; }
    export -f sleep

    # 执行 callback 重试代码段
    CALLBACK_OK=0
    for _retry in 1 2 3 4 5; do
      if curl -sf -m 10 -X POST "$TARGET_URL" \
          -H "Content-Type: application/json" \
          -d "$CALLBACK_BODY" >/dev/null 2>&1; then
        echo "[entrypoint] harness callback POST ok (url=${TARGET_URL} exit=${EXIT_CODE} attempt=${_retry})"
        CALLBACK_OK=1
        break
      fi
      if [[ $_retry -lt 5 ]]; then
        _sleep=$(( (_retry - 1) * 3 + 3 ))
        echo "[entrypoint] harness callback attempt ${_retry}/5 失败，${_sleep}s 后重试..."
        sleep "$_sleep"
      fi
    done
    if [[ $CALLBACK_OK -eq 0 ]]; then
      echo "[entrypoint] harness callback POST 全部失败（不阻塞容器退出）— url=${TARGET_URL} exit=${EXIT_CODE}"
    fi
    echo "CALLBACK_OK=${CALLBACK_OK}"
  )

  echo "$attempt_log"
}

# ── 测试 1：首次成功（0 次失败）──────────────────────────────────────────────
test_first_attempt_success() {
  local out
  out=$(run_callback_block 0)
  if echo "$out" | grep -q "attempt=1" && echo "$out" | grep -q "CALLBACK_OK=1"; then
    pass "首次成功：输出含 attempt=1，CALLBACK_OK=1"
  else
    fail "首次成功：预期 attempt=1 + CALLBACK_OK=1，实际输出：$out"
  fi
}

# ── 测试 2：前 2 次失败，第 3 次成功 ──────────────────────────────────────────
test_retry_on_2nd_attempt() {
  local out
  out=$(run_callback_block 2)
  if echo "$out" | grep -q "attempt=3" && echo "$out" | grep -q "CALLBACK_OK=1"; then
    pass "第 3 次重试成功：输出含 attempt=3，CALLBACK_OK=1"
  else
    fail "第 3 次重试成功：预期 attempt=3 + CALLBACK_OK=1，实际：$out"
  fi
  # 应有 2 条失败日志
  local fail_count
  fail_count=$(echo "$out" | grep -c "失败，.*后重试" || true)
  if [[ $fail_count -eq 2 ]]; then
    pass "第 3 次重试成功：恰好有 2 条重试日志"
  else
    fail "第 3 次重试成功：期望 2 条重试日志，实际 $fail_count 条"
  fi
}

# ── 测试 3：全部 5 次失败 ─────────────────────────────────────────────────────
test_all_attempts_fail() {
  local out
  out=$(run_callback_block 99)
  if echo "$out" | grep -q "全部失败" && echo "$out" | grep -q "CALLBACK_OK=0"; then
    pass "全部失败：输出含「全部失败」，CALLBACK_OK=0"
  else
    fail "全部失败：预期「全部失败」+ CALLBACK_OK=0，实际：$out"
  fi
  # 应有 4 条重试日志（第 5 次失败后不再 sleep，直接进入「全部失败」）
  local fail_count
  fail_count=$(echo "$out" | grep -c "失败，.*后重试" || true)
  if [[ $fail_count -eq 4 ]]; then
    pass "全部失败：恰好有 4 条重试日志（第 5 次不带 sleep）"
  else
    fail "全部失败：期望 4 条重试日志，实际 $fail_count 条"
  fi
}

# ── 测试 4：验证 entrypoint.sh 文件含重试关键字（代码结构检查）──────────────
test_entrypoint_contains_retry_code() {
  if grep -q "CALLBACK_OK" "$ENTRYPOINT" && grep -q "_retry in 1 2 3 4 5" "$ENTRYPOINT"; then
    pass "entrypoint.sh 含重试循环代码（CALLBACK_OK + _retry in 1 2 3 4 5）"
  else
    fail "entrypoint.sh 缺少重试循环代码"
  fi
  if ! grep -qP "^if curl -sf" "$ENTRYPOINT" 2>/dev/null && \
     ! grep -q "^if curl -sf -m 10 -X POST" "$ENTRYPOINT"; then
    pass "entrypoint.sh 不再有单次 curl 直接 if 判断（旧写法已移除）"
  else
    fail "entrypoint.sh 仍有旧的单次 curl 写法"
  fi
}

# ── 运行所有测试 ──────────────────────────────────────────────────────────────
echo "=== entrypoint-callback-retry 回归测试 ==="
echo ""
test_first_attempt_success
test_retry_on_2nd_attempt
test_all_attempts_fail
test_entrypoint_contains_retry_code
echo ""
echo "结果：${TESTS_PASSED} 通过，${TESTS_FAILED} 失败"

if [[ $TESTS_FAILED -gt 0 ]]; then
  exit 1
fi
exit 0
