#!/usr/bin/env bash
# codex-remote-launch.test.sh — 白名单 + 核心流程单元自测（mock ssh/scp）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/../codex-remote-launch.sh"
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

  cat >"$BIN/ssh" <<SH
#!/bin/bash
echo "ssh \$*" >> "$LOG"
if [[ "\$*" == *"echo ok"* ]]; then echo ok; exit 0; fi
if [[ "\$*" == *"mkdir -p"* ]]; then exit 0; fi
if [[ "\$*" == *"chmod 600"* ]]; then exit 0; fi
if [[ "\$*" == *"tmux new-session"* ]]; then exit 0; fi
if [[ "\$*" == *"tmux ls"* ]]; then echo "mock-session: 1 windows"; exit 0; fi
if [[ "\$*" == *"cat >"* ]]; then exit 0; fi
exit 0
SH
  chmod +x "$BIN/ssh"

  cat >"$BIN/scp" <<SH
#!/bin/bash
echo "scp \$*" >> "$LOG"
dest="\${@: -1}"
if [[ "\$dest" != *":"* ]]; then
  echo '{"mock":"auth"}' > "\$dest"
fi
exit 0
SH
  chmod +x "$BIN/scp"

  export PATH="$BIN:$PATH"
  export HOME
  mkdir -p "$HOME/.codex-team1" "$HOME/.codex-team2" "$HOME/.codex-team3" "$HOME/.codex-team4" "$HOME/.codex-team5"
  echo '{"mock":"team1"}' > "$HOME/.codex-team1/auth.json"
  echo '{"mock":"team2"}' > "$HOME/.codex-team2/auth.json"
  echo '{"mock":"team3"}' > "$HOME/.codex-team3/auth.json"
  echo '{"mock":"team4"}' > "$HOME/.codex-team4/auth.json"
  echo '{"mock":"team5"}' > "$HOME/.codex-team5/auth.json"
}

teardown() { rm -rf "$TMP"; }

test_team1_now_allowed() {
  setup
  if bash "$TARGET" --team team1 --dry-run >/tmp/out.$$ 2>&1; then
    pass "team1 现在被 --dry-run 接受（此前应被拒绝）"
  else
    fail "team1 现在被 --dry-run 接受（此前应被拒绝）" "$(cat /tmp/out.$$)"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_team2_now_allowed() {
  setup
  if bash "$TARGET" --team team2 --dry-run >/tmp/out.$$ 2>&1; then
    pass "team2 现在被 --dry-run 接受（此前应被拒绝）"
  else
    fail "team2 现在被 --dry-run 接受（此前应被拒绝）" "$(cat /tmp/out.$$)"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_team6_still_rejected() {
  setup
  if bash "$TARGET" --team team6 --dry-run >/tmp/out.$$ 2>&1; then
    fail "team6（非法账号）应被拒绝" "脚本却成功退出"
  else
    pass "team6（非法账号）仍被拒绝"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_team3_unaffected() {
  setup
  if bash "$TARGET" --team team3 --dry-run >/tmp/out.$$ 2>&1; then
    pass "team3（原有白名单成员）行为不受影响"
  else
    fail "team3（原有白名单成员）行为不受影响" "$(cat /tmp/out.$$)"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_team4_team5_unaffected() {
  setup
  if bash "$TARGET" --team team4 --dry-run >/tmp/out.$$ 2>&1; then
    pass "team4（原有白名单成员）行为不受影响"
  else
    fail "team4（原有白名单成员）行为不受影响" "$(cat /tmp/out.$$)"
  fi
  rm -f /tmp/out.$$
  if bash "$TARGET" --team team5 --dry-run >/tmp/out.$$ 2>&1; then
    pass "team5（原有白名单成员）行为不受影响"
  else
    fail "team5（原有白名单成员）行为不受影响" "$(cat /tmp/out.$$)"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_help_mentions_team1_team2() {
  setup
  out="$(bash "$TARGET" --help 2>&1)"
  if [[ "$out" == *"team1"* && "$out" == *"team2"* ]]; then
    pass "--help 输出包含 team1/team2（白名单扩容对外可见）"
  else
    fail "--help 输出包含 team1/team2（白名单扩容对外可见）" "$out"
  fi
  teardown
}

test_remote_session_without_brief_uses_full_access() {
  setup
  if bash "$TARGET" --team team1 >/tmp/out.$$ 2>&1 && \
    grep -Fqx 'exec /opt/homebrew/bin/codex --dangerously-bypass-approvals-and-sandbox' "$LOG"; then
    pass "无 brief 的远程 Codex 会话使用 Full access"
  else
    fail "无 brief 的远程 Codex 会话使用 Full access" "$(cat "$LOG")"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_remote_session_with_brief_uses_full_access_before_prompt() {
  setup
  brief="$TMP/brief.txt"
  echo 'mock task' > "$brief"
  if bash "$TARGET" --team team1 --brief "$brief" >/tmp/out.$$ 2>&1 && \
    grep -Fq 'exec /opt/homebrew/bin/codex --dangerously-bypass-approvals-and-sandbox "$(cat /tmp/codex-brief-team1-' "$LOG"; then
    pass "有 brief 的远程 Codex 会话在 prompt 前使用 Full access"
  else
    fail "有 brief 的远程 Codex 会话在 prompt 前使用 Full access" "$(cat "$LOG")"
  fi
  rm -f /tmp/out.$$
  teardown
}

echo "=== codex-remote-launch.sh 白名单扩容测试 ==="
test_team1_now_allowed
test_team2_now_allowed
test_team6_still_rejected
test_team3_unaffected
test_team4_team5_unaffected
test_help_mentions_team1_team2
test_remote_session_without_brief_uses_full_access
test_remote_session_with_brief_uses_full_access_before_prompt

echo ""
echo "结果: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
