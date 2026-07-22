#!/usr/bin/env bash
# codex-grok-launcher-supervisor-smoke.sh
# Smoke test: Codex/Grok Launcher + Supervisor 路由修正
#
# 验证：
#   1. harness-skill-relay.js 含 grok-launch.sh + unsupported executor
#   2. entrypoint.sh 含 grok 分支 + unsupported executor
#   3. scripts/codex-launch.sh / grok-launch.sh / codex-supervisor.mjs / grok-supervisor.mjs 存在
#   4. scripts/install-launchers.sh 存在

set -uo pipefail

PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

WORKSPACE="${WORKSPACE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

echo ""
echo "[codex-grok-launcher-supervisor-smoke] 快速冒烟验证"
echo ""

# 1. harness-skill-relay.js
RELAY="$WORKSPACE/packages/brain/src/harness-skill-relay.js"
if [[ -f "$RELAY" ]]; then
  if grep -q 'grok-launch\.sh' "$RELAY"; then
    pass "harness-skill-relay.js 含 grok-launch.sh"
  else
    fail "harness-skill-relay.js 含 grok-launch.sh" "未找到"
  fi
  if grep -q 'unsupported executor' "$RELAY"; then
    pass "harness-skill-relay.js 含 unsupported executor loud-fail"
  else
    fail "harness-skill-relay.js 含 unsupported executor loud-fail" "未找到"
  fi
else
  fail "harness-skill-relay.js 存在" "文件不存在"
fi

# 2. entrypoint.sh
ENTRYPOINT="$WORKSPACE/docker/cecelia-runner/entrypoint.sh"
if [[ -f "$ENTRYPOINT" ]]; then
  if grep -qE 'CECELIA_EXECUTOR.*grok|grok.*CECELIA_EXECUTOR' "$ENTRYPOINT"; then
    pass "entrypoint.sh 含 grok 显式分支"
  else
    fail "entrypoint.sh 含 grok 显式分支" "未找到"
  fi
  if grep -q 'unsupported executor' "$ENTRYPOINT"; then
    pass "entrypoint.sh 含 unsupported executor loud-fail"
  else
    fail "entrypoint.sh 含 unsupported executor loud-fail" "未找到"
  fi
else
  fail "entrypoint.sh 存在" "文件不存在"
fi

# 3. 新增 scripts
for script in codex-launch.sh grok-launch.sh install-launchers.sh; do
  if [[ -f "$WORKSPACE/scripts/$script" ]]; then
    pass "scripts/$script 存在"
  else
    fail "scripts/$script 存在" "文件不存在"
  fi
done

for mjs in codex-supervisor.mjs grok-supervisor.mjs; do
  if [[ -f "$WORKSPACE/scripts/$mjs" ]]; then
    pass "scripts/$mjs 存在"
  else
    fail "scripts/$mjs 存在" "文件不存在"
  fi
done

echo ""
echo "结果: ${PASS} PASS, ${FAIL} FAIL"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
