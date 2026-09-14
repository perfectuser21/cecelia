#!/usr/bin/env bash
# Smoke: Notion 排单 relation 数据驱动派发在位（2026-09-14）——
# ①migration 444 dispatch 人工列存在 ②pull 反查 ops 两表的 SQL 在位 ③硬编码枚举未回潮。
set -euo pipefail
printf '%s\n' "▶️  smoke: notion-workflow-relation-smoke.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAND1="/app/src/notion-push-sync.js"; CAND2="$SCRIPT_DIR/../../src/notion-push-sync.js"
if [ -f "$CAND1" ]; then MOD="$CAND1"; else MOD="$CAND2"; fi
MIG1="/app/migrations/444_ops_dispatch_manual.sql"; MIG2="$SCRIPT_DIR/../../migrations/444_ops_dispatch_manual.sql"
if [ -f "$MIG1" ]; then MIG="$MIG1"; elif [ -f "$MIG2" ]; then MIG="$MIG2"; else MIG=""; fi
if [ -n "$MIG" ]; then
  grep -q "ops_workflows ADD COLUMN IF NOT EXISTS dispatch" "$MIG" || { echo "❌ migration 444 缺 ops_workflows.dispatch"; exit 1; }
  grep -q "ops_agents    ADD COLUMN IF NOT EXISTS dispatch" "$MIG" || { echo "❌ migration 444 缺 ops_agents.dispatch"; exit 1; }
fi
grep -q "FROM ops_workflows WHERE replace(notion_id::text" "$MOD" || { echo "❌ workflow relation 反查 SQL 不在位"; exit 1; }
grep -q "FROM ops_agents WHERE replace(notion_id::text" "$MOD" || { echo "❌ agent relation 反查 SQL 不在位"; exit 1; }
grep -q "OPENCLAW_EXECUTORS = " "$MOD" && { echo "❌ 硬编码执行方枚举回潮"; exit 1; }
echo "✅ notion-workflow-relation-smoke OK"
