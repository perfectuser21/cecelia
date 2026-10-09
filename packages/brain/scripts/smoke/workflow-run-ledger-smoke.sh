#!/usr/bin/env bash
# Smoke: 「一切执行进 tasks 账」+排班员v1 在位（2026-09-14，决策 2dbabb48）——
# ①migration 446 workflow_run 枚举 ②派发建账调用 ③在途互斥闸 ④终态收账 SQL。
set -euo pipefail
printf '%s\n' "▶️  smoke: workflow-run-ledger-smoke.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAND1="/app/src/notion-push-sync.js"; CAND2="$SCRIPT_DIR/../../src/notion-push-sync.js"
if [ -f "$CAND1" ]; then MOD="$CAND1"; else MOD="$CAND2"; fi
MIG1="/app/migrations/446_workflow_run_task_type.sql"; MIG2="$SCRIPT_DIR/../../migrations/446_workflow_run_task_type.sql"
if [ -f "$MIG1" ]; then MIG="$MIG1"; elif [ -f "$MIG2" ]; then MIG="$MIG2"; else MIG=""; fi
[ -n "$MIG" ] && { grep -q "'workflow_run'" "$MIG" || { echo "❌ migration 446 缺 workflow_run"; exit 1; }; }
grep -q "requested_task_type: 'workflow_run'" "$MOD" || { echo "❌ 派发建账（workflow_run）不在位"; exit 1; }
grep -q "task_type='workflow_run' AND status='in_progress'" "$MOD" || { echo "❌ 排班员在途互斥闸不在位"; exit 1; }
grep -q "workflow_run' AND status='in_progress'" "$MOD" || { echo "❌ 终态收账 SQL 不在位"; exit 1; }
grep -q "stripStatusTail" "$MOD" || { echo "❌ 回执防雪球不在位"; exit 1; }
echo "✅ workflow-run-ledger-smoke OK"
