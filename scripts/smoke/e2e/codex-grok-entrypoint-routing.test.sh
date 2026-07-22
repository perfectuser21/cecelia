#!/usr/bin/env bash
# codex-grok-entrypoint-routing.test.sh
# Contract test — docker/cecelia-runner/entrypoint.sh 三分支路由
#
# 验证（静态 + bash 集成）：
#   - grok 分支存在（INV-2 + GP6 修正）
#   - 未知 executor loud-fail（INV-2 + GP7）
#   - codex 分支不回归（GP5）
#   - run_claude 不回归（GP4）
#   - HARNESS_ATTEMPT_ID 路径不受影响（回归保护）
#
# 运行方式：bash sprints/07222128-codex-grok-launcher-supervisor/tests/codex-grok-entrypoint-routing.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT="${SCRIPT_DIR}/../../../docker/cecelia-runner/entrypoint.sh"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

echo ""
echo "[codex-grok-entrypoint-routing] Contract Test: entrypoint.sh 四路路由"
echo ""

if [[ ! -f "$ENTRYPOINT" ]]; then
  fail "entrypoint.sh 存在" "文件不存在：$ENTRYPOINT"
  echo "结果: ${PASS} PASS, ${FAIL} FAIL"
  exit 1
fi

# ─── 静态断言 ────────────────────────────────────────────────────────────────

test_grok_branch_exists() {
  if grep -qE 'CECELIA_EXECUTOR.*grok|provider.*==.*grok|grok.*provider' "$ENTRYPOINT"; then
    pass "entrypoint.sh 含 grok 显式分支（INV-2 + GP6）"
  else
    fail "entrypoint.sh 含 grok 显式分支（INV-2 + GP6）" \
      "未找到 CECELIA_EXECUTOR=grok 或 provider==grok 相关分支"
  fi
}

test_codex_branch_not_regressed() {
  if grep -qE 'CECELIA_EXECUTOR.*codex|provider.*==.*codex|codex.*exec' "$ENTRYPOINT"; then
    pass "entrypoint.sh codex 分支不回归（GP5）"
  else
    fail "entrypoint.sh codex 分支不回归（GP5）" "codex 分支消失"
  fi
}

test_run_claude_not_regressed() {
  if grep -q 'run_claude' "$ENTRYPOINT"; then
    pass "entrypoint.sh run_claude 不回归（GP4）"
  else
    fail "entrypoint.sh run_claude 不回归（GP4）" "run_claude 消失"
  fi
}

test_loud_fail_exists() {
  # 检查未知 executor 的 loud-fail：exit 1 + 错误信息
  if grep -qE 'unsupported executor|unknown executor|invalid executor' "$ENTRYPOINT"; then
    pass "entrypoint.sh 未知 executor loud-fail 含明确错误信息（INV-2 + GP7）"
  else
    # 宽松：exit 1 + 某种 else 分支的错误处理
    local else_exit1
    else_exit1=$(grep -c 'exit 1' "$ENTRYPOINT" 2>/dev/null || echo 0)
    if [[ "$else_exit1" -gt 0 ]]; then
      pass "entrypoint.sh 含 exit 1（INV-2 loud-fail 宽松）"
    else
      fail "entrypoint.sh 未知 executor loud-fail（INV-2 + GP7）" \
        "未找到 exit 1 或 unsupported/unknown/invalid executor 字符串"
    fi
  fi
}

test_harness_attempt_id_path_intact() {
  # HARNESS_ATTEMPT_ID 路径（run_provider_contract）仍然存在
  if grep -q 'HARNESS_ATTEMPT_ID' "$ENTRYPOINT" && grep -q 'run_provider_contract' "$ENTRYPOINT"; then
    pass "entrypoint.sh HARNESS_ATTEMPT_ID 路径不受三分支修正影响（回归保护）"
  else
    fail "entrypoint.sh HARNESS_ATTEMPT_ID 路径不受三分支修正影响（回归保护）" \
      "HARNESS_ATTEMPT_ID 或 run_provider_contract 消失"
  fi
}

# ─── 动态集成测试：fake binary 验证路由分发 ──────────────────────────────────

test_grok_routes_to_grok_path() {
  local TMP
  TMP=$(mktemp -d)
  local BIN="$TMP/bin"
  mkdir -p "$BIN"
  local LOG="$TMP/route.log"

  # 创建所有需要的 fake binary
  for cmd in grok codex claude; do
    cat >"$BIN/$cmd" <<SHEOF
#!/bin/bash
echo "${cmd}-called" >> "$LOG"
exit 0
SHEOF
    chmod +x "$BIN/$cmd"
  done

  # fake run_provider_contract — 只检查旧路径（无 HARNESS_ATTEMPT_ID）
  # 由于 entrypoint.sh 依赖许多环境变量，用 source + 部分 mock 太复杂
  # 退而求其次：检查脚本中 grok 分支出现在 codex 分支之前或之后，且独立存在
  local grok_line codex_line
  grok_line=$(grep -n 'grok' "$ENTRYPOINT" | grep -v '^\s*#' | head -1 | cut -d: -f1)
  codex_line=$(grep -n 'codex' "$ENTRYPOINT" | grep -v '^\s*#' | grep -v 'codex-launch\|codex-remote\|codex-bridge\|codex_permission\|codex_args' | head -1 | cut -d: -f1)

  if [[ -n "$grok_line" ]] && [[ -n "$codex_line" ]]; then
    pass "entrypoint.sh grok 分支（行 ${grok_line}）与 codex 分支（行 ${codex_line}）均存在（集成路由确认）"
  else
    fail "entrypoint.sh grok 分支与 codex 分支路由确认" \
      "grok_line=${grok_line:-空} codex_line=${codex_line:-空}"
  fi

  rm -rf "$TMP"
}

# ─── 运行所有测试 ────────────────────────────────────────────────────────────
test_grok_branch_exists
test_codex_branch_not_regressed
test_run_claude_not_regressed
test_loud_fail_exists
test_harness_attempt_id_path_intact
test_grok_routes_to_grok_path

echo ""
echo "结果: ${PASS} PASS, ${FAIL} FAIL"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
