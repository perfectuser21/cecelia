#!/usr/bin/env bash
# codex-grok-launcher-routing.test.sh
# Contract test — Sprint: Codex/Grok Launcher + Supervisor
#
# 验证：
#   1. entrypoint.sh 旧路径（无 HARNESS_ATTEMPT_ID）三分支路由
#   2. CECELIA_EXECUTOR=grok 调 grok 路径（不是 run_claude）
#   3. CECELIA_EXECUTOR=unknown → exit 1 + 错误日志
#   4. CECELIA_EXECUTOR=codex 不回归
#   5. 无 CECELIA_EXECUTOR（默认 claude）不回归
#
# 运行方式：bash sprints/07222128-codex-grok-launcher-supervisor/tests/codex-grok-launcher-routing.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT="${SCRIPT_DIR}/../../../docker/cecelia-runner/entrypoint.sh"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

echo ""
echo "[codex-grok-launcher-routing] Contract Test: entrypoint.sh 三分支路由"
echo ""

# ─── 测试 1: grok 显式分支存在（INV-2 + GP6 修正） ─────────────────────────
test_grok_branch_exists() {
  if grep -qE 'CECELIA_EXECUTOR.*grok|provider.*==.*"grok"|provider.*==.*grok' "$ENTRYPOINT" 2>/dev/null; then
    pass "entrypoint.sh 含 grok 显式分支（INV-2）"
  else
    fail "entrypoint.sh 含 grok 显式分支（INV-2）" "未找到 grok 分支匹配（CECELIA_EXECUTOR=grok 或 provider==grok）"
  fi
}

# ─── 测试 2: 未知 executor loud-fail 存在（INV-2 + GP7） ────────────────────
test_unknown_loud_fail_exists() {
  if grep -qE 'unsupported executor|unknown executor|CECELIA_EXECUTOR.*invalid|exit 1.*executor' "$ENTRYPOINT" 2>/dev/null; then
    pass "entrypoint.sh 含未知 executor loud-fail（INV-2 loud-fail）"
  else
    # 更宽松检查：同时有 exit 1 和 executor 相关错误提示
    local has_exit1
    has_exit1=$(grep -c 'exit 1' "$ENTRYPOINT" 2>/dev/null || echo 0)
    local has_executor_err
    has_executor_err=$(grep -cE 'unsupported|unknown|executor.*error|error.*executor' "$ENTRYPOINT" 2>/dev/null || echo 0)
    if [[ "$has_exit1" -gt 0 ]] && [[ "$has_executor_err" -gt 0 ]]; then
      pass "entrypoint.sh 含未知 executor loud-fail（宽松匹配）"
    else
      fail "entrypoint.sh 含未知 executor loud-fail（INV-2 loud-fail）" "exit 1=${has_exit1} executor_err=${has_executor_err}"
    fi
  fi
}

# ─── 测试 3: codex 分支仍然存在（不回归，GP5） ──────────────────────────────
test_codex_branch_not_regressed() {
  if grep -qE 'CECELIA_EXECUTOR.*codex|provider.*==.*codex|executor.*=.*codex' "$ENTRYPOINT" 2>/dev/null; then
    pass "entrypoint.sh codex 分支不回归（GP5 codex headless）"
  else
    fail "entrypoint.sh codex 分支不回归（GP5 codex headless）" "codex 分支消失"
  fi
}

# ─── 测试 4: run_claude 函数仍然存在（GP4 不回归） ──────────────────────────
test_run_claude_not_regressed() {
  if grep -q 'run_claude' "$ENTRYPOINT" 2>/dev/null; then
    pass "entrypoint.sh run_claude 函数不回归（GP4 claude headless）"
  else
    fail "entrypoint.sh run_claude 函数不回归（GP4 claude headless）" "run_claude 消失"
  fi
}

# ─── 测试 5: grok-launch.sh 文件存在（FR-R4）───────────────────────────────
test_grok_launch_sh_exists() {
  local target="${SCRIPT_DIR}/../../../scripts/grok-launch.sh"
  if [[ -f "$target" ]]; then
    pass "scripts/grok-launch.sh 存在（FR-R4）"
  else
    fail "scripts/grok-launch.sh 存在（FR-R4）" "文件不存在"
  fi
}

# ─── 测试 6: codex-launch.sh 文件存在（FR-R3）──────────────────────────────
test_codex_launch_sh_exists() {
  local target="${SCRIPT_DIR}/../../../scripts/codex-launch.sh"
  if [[ -f "$target" ]]; then
    pass "scripts/codex-launch.sh 存在（FR-R3）"
  else
    fail "scripts/codex-launch.sh 存在（FR-R3）" "文件不存在"
  fi
}

# ─── 测试 7: codex-supervisor.mjs 存在（FR-R5）─────────────────────────────
test_codex_supervisor_exists() {
  local target="${SCRIPT_DIR}/../../../scripts/codex-supervisor.mjs"
  if [[ -f "$target" ]]; then
    pass "scripts/codex-supervisor.mjs 存在（FR-R5）"
  else
    fail "scripts/codex-supervisor.mjs 存在（FR-R5）" "文件不存在"
  fi
}

# ─── 测试 8: grok-supervisor.mjs 存在（FR-R6）──────────────────────────────
test_grok_supervisor_exists() {
  local target="${SCRIPT_DIR}/../../../scripts/grok-supervisor.mjs"
  if [[ -f "$target" ]]; then
    pass "scripts/grok-supervisor.mjs 存在（FR-R6）"
  else
    fail "scripts/grok-supervisor.mjs 存在（FR-R6）" "文件不存在"
  fi
}

# ─── 测试 9: install-launchers.sh 存在（FR-R8）─────────────────────────────
test_install_launchers_exists() {
  local target="${SCRIPT_DIR}/../../../scripts/install-launchers.sh"
  if [[ -f "$target" ]]; then
    pass "scripts/install-launchers.sh 存在（FR-R8）"
  else
    fail "scripts/install-launchers.sh 存在（FR-R8）" "文件不存在"
  fi
}

# ─── 测试 10: harness-skill-relay.js 含 grok-launch.sh（INV-1 GREEN）────────
test_relay_has_grok_launch() {
  local target="${SCRIPT_DIR}/../../../packages/brain/src/harness-skill-relay.js"
  if grep -q 'grok-launch\.sh' "$target" 2>/dev/null; then
    pass "harness-skill-relay.js 含 grok-launch.sh（INV-1 三分支 GREEN）"
  else
    fail "harness-skill-relay.js 含 grok-launch.sh（INV-1 三分支 GREEN）" "grok-launch.sh 缺失 — bug 未修复"
  fi
}

# ─── 运行所有测试 ──────────────────────────────────────────────────────────────
test_grok_branch_exists
test_unknown_loud_fail_exists
test_codex_branch_not_regressed
test_run_claude_not_regressed
test_grok_launch_sh_exists
test_codex_launch_sh_exists
test_codex_supervisor_exists
test_grok_supervisor_exists
test_install_launchers_exists
test_relay_has_grok_launch

echo ""
echo "结果: ${PASS} PASS, ${FAIL} FAIL"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
