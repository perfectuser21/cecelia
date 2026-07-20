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
  mkdir -p "$HOME/.codex-team1" "$HOME/.codex-team2" "$HOME/.codex-team3"
  echo '{"mock":"team1"}' > "$HOME/.codex-team1/auth.json"
  echo '{"mock":"team2"}' > "$HOME/.codex-team2/auth.json"
  echo '{"mock":"team3"}' > "$HOME/.codex-team3/auth.json"
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

echo "=== codex-remote-launch.sh 白名单扩容测试 ==="
test_team1_now_allowed
test_team2_now_allowed
test_team6_still_rejected
test_team3_unaffected

echo ""
echo "结果: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
