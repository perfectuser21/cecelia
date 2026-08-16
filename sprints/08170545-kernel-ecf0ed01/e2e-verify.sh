#!/bin/bash
# Final E2E — Diff Impact Gate 确定性 verdict 落 orchestrator_decision_log（target_environment=local_api）
# 真 Postgres（scratch $DB_URL）+ 真 kernel 代码（diff-gate 分类 + harness-gates 回执 + decision-log 写入全真跑）。
# 唯一录制件是未改的上游 mapper 输出（见 contract-draft.md「未覆盖真实链路清单」）。
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
ROOT="$(git rev-parse --show-toplevel)"
SPRINT_DIR="${SPRINT_DIR:-sprints/08170545-kernel-ecf0ed01}"
export SPRINT_ABS="$ROOT/$SPRINT_DIR"
cd "$ROOT/packages/brain"

# 1. 空库 bootstrap：仓库真实 migration；机检目标表存在
node src/migrate.js
psql "$DB_URL" -tAc "SELECT to_regclass('orchestrator_decision_log') IS NOT NULL" | grep -qx t

# 2. 真实 diff-gate 分类 + 真实 harness-gates 回执 + 真实 decision-log 写入
RUN_ID=$(node --input-type=module -e '
  import pg from "pg";
  import { readFileSync } from "node:fs";
  import { createHarnessImpactGates } from "./src/impact-contract/harness-gates.js";
  import { evaluateDiffGate } from "./src/impact-contract/diff-gate.js";
  import { appendHop } from "./src/orchestrator/decision-log.js";
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const rec = JSON.parse(readFileSync(process.env.SPRINT_ABS + "/tests/fixtures/d1360a48-radius-recording.json", "utf8"));
  const HEAD = "b".repeat(40);
  const r = await pool.query("INSERT INTO initiative_runs (initiative_id, phase) VALUES (gen_random_uuid(), $1) RETURNING id", ["B_task_loop"]);
  const runId = r.rows[0].id;
  const gates = createHarnessImpactGates({
    db: pool,
    getActiveContract: async () => ({ id: "contract-e2e", contract_hash: "c".repeat(64), repo: "cecelia", base_revision: "a".repeat(40), contract_body: { required_assertions: [] } }),
    diffGate: async ({ taskId, repo, headRevision, changedFiles }) => evaluateDiffGate({ taskId, repo, headRevision, changedFiles, mapClient: async () => rec }),
  });
  const receipt = await gates.beforeEvaluate({
    task: { id: "11111111-1111-4111-8111-111111111111", payload: {} },
    pr: { type: "git_candidate", verification_status: "verified", head_sha: HEAD, changed_files: rec.changed_files },
    run: { impact_contract_policy: "required" },
  });
  if (receipt.gate !== "blocked" || receipt.reason !== "impact_anchor_missing" || receipt.retryable !== false) {
    console.error("FAIL receipt=" + JSON.stringify(receipt)); await pool.end(); process.exit(1);
  }
  await appendHop(pool, { runId, hop: 1, observed: { note: "e2e-impact-gate" }, derivedPhase: "evaluate", gateVerdict: "deny:impact:" + receipt.reason, action: "spawn:evaluator", detail: { impact_gate: receipt } });
  await pool.end();
  process.stdout.write(runId);
')
echo "run_id=$RUN_ID"

# 3. psql 断言：确定性 verdict 落库（时间窗防历史数据造假）
psql "$DB_URL" -tAc "SELECT gate_verdict FROM orchestrator_decision_log WHERE run_id='$RUN_ID' AND created_at > NOW() - interval '5 minutes'" | grep -qx "deny:impact:impact_anchor_missing" || { echo "FAIL: gate_verdict 不是 deny:impact:impact_anchor_missing"; exit 1; }
psql "$DB_URL" -tAc "SELECT (detail->'impact_gate'->>'retryable') FROM orchestrator_decision_log WHERE run_id='$RUN_ID'" | grep -qx "false" || { echo "FAIL: detail.impact_gate.retryable != false"; exit 1; }
UNC=$(psql "$DB_URL" -tAc "SELECT jsonb_array_length(COALESCE(detail->'impact_gate'->'unclaimed_files', detail->'impact_gate'->'detail'->'unclaimed_files', '[]'::jsonb)) FROM orchestrator_decision_log WHERE run_id='$RUN_ID'")
[ "${UNC:-0}" -ge 1 ] || { echo "FAIL: detail.impact_gate.unclaimed_files 为空"; exit 1; }
echo "✅ Golden Path 验证通过：确定性 impact verdict 落库 retryable=false + unclaimed_files 非空"
