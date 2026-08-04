#!/usr/bin/env bash
# sprints/08041554-doc-foundation-knife0/tests/doc-foundation-contract.test.sh
#
# 刀0 文档正本落地 — 静态契约断言（TDD 阶段验证用）
#
# Commit-1（TDD 红）阶段：实现文件不存在时，预期 PASS=0 FAIL=4
# Commit-2（TDD 绿）阶段：全部实现后，预期 PASS=4 FAIL=0
#
# 用法：bash sprints/08041554-doc-foundation-knife0/tests/doc-foundation-contract.test.sh
# 或从仓库根目录：bash packages/engine/tests/integrity/doc-foundation-contract.test.sh

set -euo pipefail

PASS=0
FAIL=0

_pass() { echo "  PASS  $1"; PASS=$((PASS + 1)); }
_fail() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

echo "[doc-foundation-contract] 开始静态契约断言..."

# ── 断言 1：正本文件存在且含双 marker ────────────────────────────────────────
KERNEL_FILE="packages/workflows/KERNEL_CONTEXT.md"

if [[ -f "$KERNEL_FILE" ]] \
  && grep -q '<!-- HARD_RULES:BEGIN -->' "$KERNEL_FILE" \
  && grep -q '<!-- HARD_RULES:END -->' "$KERNEL_FILE"; then
  _pass "ASSERT-1: $KERNEL_FILE 存在且含 HARD_RULES:BEGIN / HARD_RULES:END marker"
else
  _fail "ASSERT-1: $KERNEL_FILE 不存在或缺少 HARD_RULES marker（I-1 I-2 未满足）"
fi

# ── 断言 2：三方对账脚本已升级为三方 ─────────────────────────────────────────
SYNC_SCRIPT="scripts/check-agents-rules-sync.sh"

if [[ -f "$SYNC_SCRIPT" ]] \
  && grep -q 'packages/workflows/KERNEL_CONTEXT.md' "$SYNC_SCRIPT"; then
  _pass "ASSERT-2: $SYNC_SCRIPT 已升级为三方对账（含正本路径引用）"
else
  _fail "ASSERT-2: $SYNC_SCRIPT 未升级为三方对账——缺少 packages/workflows/KERNEL_CONTEXT.md 引用（I-3 未满足）"
fi

# ── 断言 3：docs 目录登记 smoke 脚本存在且可执行 ──────────────────────────────
SMOKE_SCRIPT="scripts/smoke/check-docs-dir-registry-smoke.sh"

if [[ -f "$SMOKE_SCRIPT" ]] && [[ -x "$SMOKE_SCRIPT" ]]; then
  _pass "ASSERT-3: $SMOKE_SCRIPT 存在且可执行（I-4 I-6 满足）"
else
  _fail "ASSERT-3: $SMOKE_SCRIPT 不存在或不可执行（I-4 I-6 未满足）"
fi

# ── 断言 4：基线文件存在且非空 ────────────────────────────────────────────────
BASELINE_FILE="docs/current/docs-dir-baseline.txt"

if [[ -f "$BASELINE_FILE" ]] && [[ -s "$BASELINE_FILE" ]]; then
  _pass "ASSERT-4: $BASELINE_FILE 存在且非空（I-5 祖父条款满足）"
else
  _fail "ASSERT-4: $BASELINE_FILE 不存在或为空（I-5 祖父条款未满足）"
fi

# ── 结果汇总 ──────────────────────────────────────────────────────────────────
echo ""
echo "[doc-foundation-contract] PASS=$PASS FAIL=$FAIL"

if [[ "$FAIL" -gt 0 ]]; then
  echo "[doc-foundation-contract] FAIL（commit-1 红阶段正常，commit-2 后应全绿）"
  exit 1
else
  echo "[doc-foundation-contract] PASS — 所有契约断言满足（commit-2 绿阶段）"
  exit 0
fi
