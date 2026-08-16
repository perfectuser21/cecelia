#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DB_URL
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 空库跑仓库真实 migration，机检 orchestrator_decision_log 表存在
node -e '
  (async () => {
    const pg = (await import("pg")).default;
    const m = await import("./packages/brain/src/migrate.js");
    const pool = new pg.Pool({ connectionString: process.env.DB_URL });
    await m.runMigrations(pool);
    await pool.end();
  })().catch((e) => { console.error(e); process.exit(1); });
'
psql "$DB_URL" -tAc "SELECT to_regclass('orchestrator_decision_log') IS NOT NULL" | grep -qx t || { echo "FAIL: orchestrator_decision_log 表缺失"; exit 1; }

# 2. 真跑 diff-gate + harness-gates 受影响代码，经真实 appendHop 写决策日志行
node -e '
  (async () => {
    const pg = (await import("pg")).default;
    const pool = new pg.Pool({ connectionString: process.env.DB_URL });
    const { evaluateDiffGate } = await import("./packages/brain/src/impact-contract/diff-gate.js");
    const { createHarnessImpactGates } = await import("./packages/brain/src/impact-contract/harness-gates.js");
    const { appendHop } = await import("./packages/brain/src/orchestrator/decision-log.js");
    const HEAD = "b".repeat(40);
    const active = { id: "c1", task_id: "0ca4b234", repo: "perfectuser21/cecelia", base_revision: "a".repeat(40), contract_hash: "c".repeat(64) };
    const recorded = { freshness: { status: "unknown", reason_code: "impact_anchor_missing" }, fact_revisions: { cecelia: "bc4e8644" }, affected_nodes: [], required_assertions: [], unclaimed_files: ["DoD.md"] };
    const gates = createHarnessImpactGates({
      db: pool,
      getActiveContract: async () => active,
      getGap: async () => null,
      diffGate: (args) => evaluateDiffGate(Object.assign({}, args, { db: null, mapClient: async () => recorded })),
    });
    const receipt = await gates.beforeEvaluate({
      task: { id: "0ca4b234", payload: {} },
      pr: { head_sha: HEAD, type: "git_candidate", verification_status: "verified", changed_files: ["DoD.md"] },
      run: { id: "seed", impact_contract_policy: "required" },
    });
    if (receipt.gate !== "blocked" || receipt.reason !== "impact_anchor_missing" || receipt.retryable !== false) {
      console.error("FAIL: receipt", JSON.stringify(receipt)); process.exit(1);
    }
    if (!receipt.detail || !Array.isArray(receipt.detail.unclaimed_files) || receipt.detail.unclaimed_files.length === 0) {
      console.error("FAIL: receipt.detail.unclaimed_files 缺失", JSON.stringify(receipt)); process.exit(1);
    }
    const gateVerdict = "deny:impact:" + receipt.reason;
    const runRow = await pool.query("INSERT INTO initiative_runs (initiative_id) VALUES (gen_random_uuid()) RETURNING id");
    const runId = runRow.rows[0].id;
    await appendHop(pool, {
      runId, hop: 1,
      observed: { task: { id: "0ca4b234" }, candidate: { head_sha: HEAD } },
      derivedPhase: "evaluate", gateVerdict, action: "spawn:evaluator",
      detail: { reason: "impact_gate_deny", impact_gate: receipt },
    });
    console.log("WROTE run", runId, "verdict", gateVerdict);
    await pool.end();
  })().catch((e) => { console.error(e); process.exit(1); });
'

# 3. psql 验证 orchestrator_decision_log 新增行（带 5 分钟时间窗防造假）
ROW=$(psql "$DB_URL" -tAc "SELECT gate_verdict FROM orchestrator_decision_log WHERE gate_verdict='deny:impact:impact_anchor_missing' AND detail->'impact_gate'->>'retryable'='false' AND jsonb_array_length(COALESCE(detail->'impact_gate'->'detail'->'unclaimed_files','[]'::jsonb)) > 0 AND created_at > NOW() - interval '5 minutes'")
[ -n "$ROW" ] || { echo "FAIL: orchestrator_decision_log 无 deny:impact:impact_anchor_missing/retryable=false/unclaimed_files 非空 的时窗内行"; exit 1; }
echo "OK E2E: $ROW"
