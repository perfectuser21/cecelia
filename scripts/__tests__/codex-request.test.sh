#!/usr/bin/env bash
# codex-request.test.sh — 西安侧 pull 请求脚本单元自测（mock ssh/scp/codex）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/../codex-request.sh"
PASS=0; FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

setup() {
  TMP=$(mktemp -d)
  HOME="$TMP/home"
  mkdir -p "$HOME"
  BIN="$TMP/bin"
  mkdir -p "$BIN"
  LOG="$TMP/calls.log"
  touch "$LOG"

  cat >"$BIN/ssh" <<SH
#!/bin/bash
echo "ssh \$*" >> "$LOG"
if [[ "\$*" == *"echo ok"* ]]; then echo ok; exit 0; fi
exit 0
SH
  chmod +x "$BIN/ssh"

  cat >"$BIN/scp" <<SH
#!/bin/bash
echo "scp \$*" >> "$LOG"
dest="\${@: -1}"
if [[ "\$dest" != *":"* ]]; then
  echo '{"mock":"pulled-token"}' > "\$dest"
fi
exit 0
SH
  chmod +x "$BIN/scp"

  cat >"$BIN/codex" <<SH
#!/bin/bash
echo "codex ran with CODEX_HOME=\$CODEX_HOME" >> "$LOG"
exit "\${CODEX_MOCK_EXIT_CODE:-0}"
SH
  chmod +x "$BIN/codex"

  export PATH="$BIN:$PATH"
  export HOME
}

teardown() { rm -rf "$TMP"; }

test_invalid_team_rejected() {
  setup
  if bash "$TARGET" --team team6 >/tmp/out.$$ 2>&1; then
    fail "非法 team（team6）应被拒绝" "脚本却成功退出"
  else
    pass "非法 team（team6）被拒绝"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_missing_team_rejected() {
  setup
  if bash "$TARGET" >/tmp/out.$$ 2>&1; then
    fail "缺少 --team 参数应报错" "脚本却成功退出"
  else
    pass "缺少 --team 参数报错"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_pull_then_run_then_pushback_on_success() {
  setup
  set +e
  CODEX_MOCK_EXIT_CODE=0 bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1
  local rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    fail "codex 正常退出(0)时脚本应以 0 退出" "实际 rc=$rc, 输出: $(cat /tmp/out.$$)"
  elif ! grep -q "codex ran with CODEX_HOME=$HOME/.codex-team3" "$LOG"; then
    fail "应以正确 CODEX_HOME 前台运行 codex" "$(cat "$LOG")"
  elif [[ "$(grep -c '^scp ' "$LOG")" -lt 2 ]]; then
    fail "应发生至少 2 次 scp（拉取 + 推回）" "$(cat "$LOG")"
  elif ! (grep -F -- "$HOME/.codex-team3/auth.json" "$LOG" | grep -qE ':[^[:space:]]*$'); then
    fail "应有一次 scp 以本地 auth.json（$HOME/.codex-team3/auth.json）为源、推回远端(host:path)" "$(cat "$LOG")"
  else
    pass "正常退出：拉取→前台跑codex→推回 全流程正确（含 scp src/dest 方向校验）"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_pushback_happens_even_on_nonzero_exit() {
  setup
  set +e
  CODEX_MOCK_EXIT_CODE=7 bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1
  local rc=$?
  set -e
  if [[ "$rc" -ne 7 ]]; then
    fail "脚本应透传 codex 的非零退出码(7)" "实际 rc=$rc"
  elif [[ "$(grep -c '^scp ' "$LOG")" -lt 2 ]]; then
    fail "codex 异常退出(7)时仍应触发 trap 推回token" "$(cat "$LOG")"
  else
    pass "codex 非零退出(7)时 trap 依然触发推回，且退出码透传"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_no_exec_used() {
  if grep -qE '^\s*exec\s' "$TARGET"; then
    fail "不能用 exec 跑 codex（会导致脚本进程消失、trap 不触发）" "$(grep -nE '^\s*exec\s' "$TARGET")"
  else
    pass "未使用 exec（trap 回传逻辑得以保留）"
  fi
}

test_no_token_content_printed() {
  if grep -nE 'cat[[:space:]]+.*auth\.json|echo.*auth_token|print.*refresh_token|print.*access_token' "$TARGET"; then
    fail "脚本疑似打印 token 内容" "命中上面 grep 结果"
  else
    pass "grep 确认脚本无打印 token 内容语句"
  fi
}

test_no_login_command() {
  if grep -qE 'codex[[:space:]]+login' "$TARGET"; then
    fail "西安侧脚本绝不能调用 codex login" "命中"
  else
    pass "脚本未调用 codex login（红线遵守）"
  fi
}

test_chmod_600_both_directions() {
  setup
  set +e
  CODEX_MOCK_EXIT_CODE=0 bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1
  set -e
  if [[ -f "$HOME/.codex-team3/auth.json" ]]; then
    local mode
    mode=$(stat -f "%Lp" "$HOME/.codex-team3/auth.json" 2>/dev/null || stat -c "%a" "$HOME/.codex-team3/auth.json")
    if [[ "$mode" == "600" ]]; then
      pass "本地 auth.json 落盘后 mode 为 600"
    else
      fail "本地 auth.json 落盘后 mode 为 600" "实际 mode=$mode"
    fi
  else
    fail "本地 auth.json 落盘后 mode 为 600" "文件不存在"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_push_skipped_on_corrupt_local_json() {
  setup
  # 模拟 codex 运行中被 kill -9 / 磁盘满，导致本地 auth.json 被写坏成截断的非法 JSON
  cat >"$BIN/codex" <<SH
#!/bin/bash
echo "codex ran with CODEX_HOME=\$CODEX_HOME" >> "$LOG"
echo -n '{"broken' > "\$CODEX_HOME/auth.json"
exit "\${CODEX_MOCK_EXIT_CODE:-0}"
SH
  chmod +x "$BIN/codex"

  set +e
  CODEX_MOCK_EXIT_CODE=3 bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1
  local rc=$?
  set -e

  if [[ "$rc" -ne 3 ]]; then
    fail "本地 auth.json 写坏场景下脚本仍应正常透传 codex 原始退出码(3)" "实际 rc=$rc, 输出: $(cat /tmp/out.$$)"
  elif grep -F -- "$HOME/.codex-team3/auth.json" "$LOG" | grep -qE ':[^[:space:]]*$'; then
    fail "本地 auth.json 是非法 JSON 时不应发生推回 scp（会覆盖美国侧唯一持久副本）" "$(cat "$LOG")"
  elif ! grep -q "跳过推回" /tmp/out.$$; then
    fail "应打印 WARN 说明因 JSON 校验失败跳过推回" "$(cat /tmp/out.$$)"
  else
    pass "本地 auth.json 是非法 JSON 时：跳过推回、不覆盖远端，且 codex 原始退出码仍正常透传"
  fi
  rm -f /tmp/out.$$
  teardown
}

echo "=== codex-request.sh 单元测试 ==="
test_invalid_team_rejected
test_missing_team_rejected
test_pull_then_run_then_pushback_on_success
test_pushback_happens_even_on_nonzero_exit
test_no_exec_used
test_no_token_content_printed
test_no_login_command
test_chmod_600_both_directions
test_push_skipped_on_corrupt_local_json

echo ""
echo "结果: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
