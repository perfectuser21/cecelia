#!/bin/bash
# final-e2e / DoD B-06 — 确定性 impact 闸落 orchestrator_decision_log（local_api，scratch 库）
# 真跑被改的边：diff-gate 三类分流 + gateReceipt detail 透传 + appendHop 真 Postgres 写行。
# 旧代码落 deny:impact:mapper_stale/retryable:true（断言 FAIL）；新代码落 deny:impact:impact_anchor_missing/retryable:false（PASS）。
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped scratch DB_URL}"
export DATABASE_URL="$DB_URL"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." 2>/dev/null && pwd || echo /workspace)"
cd "$REPO_ROOT"
DRIVER="$(mktemp /tmp/impact-e2e-XXXXXX.mjs)"
cleanup() { rm -f "$DRIVER"; }
trap cleanup EXIT

# 1. 空库 bootstrap：跑仓库真实 migration，机检目标表存在
node -e 'import("./packages/brain/src/migrate.js").then(async (m)=>{const {default:pg}=await import("pg");const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});await m.runMigrations(pool);await pool.end();}).catch(e=>{console.error(e);process.exit(1);})'
psql "$DB_URL" -tAc "SELECT to_regclass('orchestrator_decision_log') IS NOT NULL" | grep -qx t
psql "$DB_URL" -tAc "SELECT to_regclass('initiative_runs') IS NOT NULL" | grep -qx t

# 2. 驱动真实被改代码路径，落一条确定性 impact 闸决策到 orchestrator_decision_log
cat > "$DRIVER" <<'MJS'
import pg from 'pg';
import { evaluateDiffGate } from './packages/brain/src/impact-contract/diff-gate.js';
import { createHarnessImpactGates } from './packages/brain/src/impact-contract/harness-gates.js';
import { appendHop, nextHop } from './packages/brain/src/orchestrator/decision-log.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const HEAD = 'b'.repeat(40);
const active = { id: 'contract-e2e', repo: 'cecelia', base_revision: 'bc4e8644', contract_hash: 'c'.repeat(64), contract_body: { affected_capabilities: [{ capability_id: 'impact-contract' }], required_assertions: [] } };
const recordedMapper = async () => ({ freshness: { status: 'unknown', reason_code: 'impact_anchor_missing' }, fact_revisions: { cecelia: 'bc4e8644' }, affected_nodes: ['impact-contract'], required_assertions: [], unclaimed_files: ['DoD.md'] });
const diffGate = (args) => evaluateDiffGate({ ...args, db: { query: async () => ({ rows: [active] }) }, mapClient: recordedMapper });
const gates = createHarnessImpactGates({ db: {}, getActiveContract: async () => active, diffGate, readChangedFiles: async () => ['DoD.md'] });
const receipt = await gates.beforeEvaluate({ task: { id: 'task-e2e', payload: {} }, pr: { head_sha: HEAD } });
if (receipt.gate !== 'blocked' || receipt.retryable !== false) { console.error('FAIL: receipt 非确定性 blocked', receipt); process.exit(1); }
const gateVerdict = `deny:impact:${receipt.reason}`;
const client = await pool.connect();
try {
  const { rows } = await client.query("INSERT INTO initiative_runs (initiative_id, phase) VALUES (gen_random_uuid(), 'B_task_loop') RETURNING id");
  const runId = rows[0].id;
  const hop = await nextHop(pool, runId);
  await appendHop(pool, { runId, hop, observed: {}, derivedPhase: 'evaluate', gateVerdict, action: 'spawn:evaluator', detail: { reason: 'diff_impact_gate', impact_gate: receipt } });
  process.stdout.write(runId);
} finally { client.release(); await pool.end(); }
MJS
RUN_ID="$(DATABASE_URL="$DB_URL" node "$DRIVER")"
[ -n "$RUN_ID" ] || { echo "FAIL: driver 未返回 run_id"; exit 1; }

# 3. psql 验证：新增行 gate_verdict + detail.impact_gate.retryable=false + unclaimed_files 非空（带时间窗防伪）
VERDICT=$(psql "$DB_URL" -tAc "SELECT gate_verdict FROM orchestrator_decision_log WHERE run_id='$RUN_ID' AND detail->'impact_gate'->>'retryable'='false' AND jsonb_array_length(COALESCE(detail->'impact_gate'->'detail'->'unclaimed_files','[]'::jsonb)) >= 1 AND created_at > NOW() - interval '5 minutes'" | tr -d '[:space:]')
[ "$VERDICT" = "deny:impact:impact_anchor_missing" ] || { echo "FAIL: 期望 deny:impact:impact_anchor_missing 且 retryable=false 且 unclaimed_files 非空，实得 gate_verdict='$VERDICT'"; exit 1; }

echo "✅ Golden Path 验证通过：orchestrator_decision_log 落 deny:impact:impact_anchor_missing / retryable=false / unclaimed_files 非空"
