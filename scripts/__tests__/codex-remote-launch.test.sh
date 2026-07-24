#!/usr/bin/env bash
# codex-remote-launch.test.sh — 退役入口回归测试
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/../codex-remote-launch.sh"
PASS=0
FAIL=0

pass() {
  echo "  PASS: $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "  FAIL: $1 — $2"
  FAIL=$((FAIL + 1))
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
HOME_DIR="$TMP/home"
BIN="$TMP/bin"
TRACE="$TMP/child-network.trace"
STDOUT="$TMP/stdout"
STDERR="$TMP/stderr"
mkdir -p "$HOME_DIR" "$BIN"
: >"$TRACE"

# 任何旧入口可能触发的 child/network 命令都变成确定性 tripwire。
for command_name in ssh scp codex tmux curl wget nc socat; do
  cat >"$BIN/$command_name" <<EOF
#!/bin/sh
printf 'called:%s\n' "\${0##*/}" >> "$TRACE"
exit 97
EOF
  chmod +x "$BIN/$command_name"
done

set +e
HOME="$HOME_DIR" \
PATH="$BIN" \
CODEX_BIN=codex \
CODEX_REMOTE_HOST=forbidden \
/bin/bash "$TARGET" --team team3 >"$STDOUT" 2>"$STDERR"
RC=$?
set -e

if [[ "$RC" -eq 64 ]]; then
  pass "合法旧参数以 exit 64 硬退役"
else
  fail "合法旧参数必须以 exit 64 硬退役" "实际 rc=$RC"
fi

EXPECTED='codex-remote-launch is retired; use: codex-slot start [--project <project>] [--name <name>]'
if [[ ! -s "$STDOUT" && "$(cat "$STDERR")" == "$EXPECTED" ]]; then
  pass "唯一输出是指向 codex-slot start 的退役提示"
else
  fail "唯一输出必须是指向 codex-slot start 的退役提示" "stdout=$(cat "$STDOUT") stderr=$(cat "$STDERR")"
fi

if [[ ! -s "$TRACE" ]]; then
  pass "退役发生在 ssh/scp/codex/tmux/网络 child 之前"
else
  fail "退役入口不得触发 child/network" "$(cat "$TRACE")"
fi

if [[ -z "$(find "$HOME_DIR" -mindepth 1 -print -quit)" ]]; then
  pass "退役入口未创建或改写 auth/用户目录"
else
  fail "退役入口不得产生 auth 落盘副作用" "$(find "$HOME_DIR" -mindepth 1 -print)"
fi

echo ""
echo "结果: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
