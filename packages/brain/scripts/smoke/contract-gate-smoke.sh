#!/usr/bin/env bash
# contract-gate-smoke.sh
# 真环境 smoke：在真实 node 进程里跑 Contract Gate CLI 打全部 repo 内 fixtures，
# 断言退出码 + 命中清单符合契约。被测对象是真实 packages/brain CLI/库，非 mock。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"
CLI="node packages/brain/scripts/contract-gate-check.mjs"
FX="packages/brain/src/lib/__tests__/fixtures/contract-gate"
fail() { echo "❌ SMOKE FAIL: $1"; exit 1; }

# 1. 作弊样本 → 非零退出 + ≥6 条 HIT + 6 类 ruleId 全覆盖
OUT="$($CLI "$FX/cheat" 2>&1)" && fail "作弊样本应非零退出"
HITS="$(printf '%s\n' "$OUT" | grep -cE '^HIT ' || true)"
[ "$HITS" -ge 6 ] || fail "命中 $HITS < 6"
for R in weak-oracle/curl-no-jq cheat/mock-env cheat/exit-0-fallback cheat/or-true weak-oracle/file-existence-only weak-oracle/tautology; do
  printf '%s\n' "$OUT" | grep -q "$R" || fail "规则 $R 未命中"
done

# 2. 干净样本 → exit 0
$CLI "$FX/clean" >/dev/null 2>&1 || fail "干净样本应 exit 0"

# 3. 工具 preflight → env_missing + 工具名
OUT3="$($CLI "$FX/env-missing" 2>&1)" && fail "env-missing 应非零退出"
printf '%s\n' "$OUT3" | grep -q 'env_missing' || fail "缺 env_missing 标记"

# 4. 领域规则 → DB 无时间窗（CLI 预期非零退出，先捕获再 grep，避开 pipefail）
OUT4="$($CLI "$FX/db-no-window" 2>&1)" && fail "db-no-window 应非零退出"
printf '%s\n' "$OUT4" | grep -q 'domain/db-no-time-window' || fail "未命中 domain/db-no-time-window"

# 5. 误报逃生口 → 豁免留痕 + exit 0
OUT5="$($CLI "$FX/exempt" 2>&1)"; RC5=$?
printf '%s\n' "$OUT5" | grep -qiE 'gate-allow|豁免|exempt' || fail "豁免未留痕"
[ "$RC5" -eq 0 ] || fail "唯一命中被豁免后应 exit 0（实际 $RC5）"

# 6. 边界 fail-closed → 空合同 / 不存在目录均非零退出
$CLI "$FX/empty" >/dev/null 2>&1 && fail "空合同应非零退出"
$CLI /nonexistent/cg/smoke/path >/dev/null 2>&1 && fail "fail-closed 失效——不存在目录竟 exit 0"

echo "✅ contract-gate-smoke 全部通过（cheat/clean/env-missing/db-no-window/exempt/边界）"
