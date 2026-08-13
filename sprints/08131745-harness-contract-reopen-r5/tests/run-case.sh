#!/usr/bin/env bash
# 模式A BEHAVIOR 执行器：在真实 Postgres 上按测试名过滤跑永久回归 CI 文件
# packages/brain/src/orchestrator/__tests__/contract-store.test.js 的指定用例并断言通过。
# 用法：bash run-case.sh "<vitest -t 过滤子串>"
set -euo pipefail
FILTER="${1:?test name filter required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/sprints/08131745-harness-contract-reopen-r5/e2e-db-env.sh"
cd "$ROOT/packages/brain"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT
npx vitest run --config vitest.integration.config.js \
  src/orchestrator/__tests__/contract-store.test.js \
  -t "$FILTER" --reporter=verbose > "$OUT" 2>&1 || true
tail -n 30 "$OUT"
grep -qE 'Tests[^0-9]*[1-9][0-9]* passed' "$OUT" || { echo "FAIL: 用例未通过 filter=$FILTER"; exit 1; }
if grep -qE 'Tests[^0-9]*[1-9][0-9]* failed' "$OUT"; then echo "FAIL: 存在失败用例 filter=$FILTER"; exit 1; fi
if grep -qE 'No test files found|matched no tests' "$OUT"; then echo "FAIL: 过滤命中 0 用例 filter=$FILTER"; exit 1; fi
echo "OK: $FILTER"
