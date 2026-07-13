#!/usr/bin/env bash
# Smoke: harness-relay-watchdog 导出的门禁函数存在且签名符合预期（静态检查，不连库不连网）。
set -euo pipefail
FILE="packages/brain/src/harness-relay-watchdog.js"

grep -q "export async function _hasEvaluatorGate" "$FILE" || { echo "FAIL: _hasEvaluatorGate 缺失"; exit 1; }
grep -q "export async function _raiseUngatedMergeAlert" "$FILE" || { echo "FAIL: _raiseUngatedMergeAlert 缺失"; exit 1; }
grep -q "export async function _finalizeMergedRun" "$FILE" || { echo "FAIL: _finalizeMergedRun 缺失"; exit 1; }
grep -q "merged_without_evaluator_gate" "$FILE" || { echo "FAIL: failure_reason 标记缺失"; exit 1; }

LEDGER="packages/brain/src/ledger-hygiene.js"
grep -q "key: 'm6'" "$LEDGER" || { echo "FAIL: m6 指标缺失"; exit 1; }

echo "PASS: harness evaluator gate 机器闸 + m6 指标均已就位"
