#!/bin/bash
# Final E2E（数据写入类，scratch 库）— Diff Impact Gate 确定性拦截落 orchestrator_decision_log
# 由 evaluator（mode B / local_api）执行，DB_URL 由 Fleet 注入本 attempt scratch 库。
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
cd /workspace

# 1. 对空 scratch 库跑仓库真实 migration；机检 orchestrator_decision_log 表存在
(npm --prefix packages/brain run migrate || node packages/brain/scripts/migrate.js) >/tmp/harness-migrate.log 2>&1 || true
psql "$DB_URL" -tAc "SELECT to_regclass('orchestrator_decision_log') IS NOT NULL" | grep -qx t \
  || { echo "FAIL: orchestrator_decision_log 表缺失"; tail -20 /tmp/harness-migrate.log; exit 1; }

# 2. 合同单测层先验被改代码分类/路由确定性（真跑 diff-gate/derive，不碰 DB）
npx vitest run sprints/08161913-kernel-8f826ee6/tests/ >/tmp/harness-unit.log 2>&1 \
  || { echo "FAIL: 合同单测未全绿"; tail -30 /tmp/harness-unit.log; exit 1; }

# 3. 用被改后的 diff-gate + 仓库真实 appendHop 写一条 impact_anchor_missing 前置闸决策行
#    （mapClient 注入 run d1360a48 真实 radius 录制件；禁伪造 DB 行）
export RUN_ID="$(node -e 'console.log(require("crypto").randomUUID())')"
node --input-type=module -e '
import pkg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { evaluateDiffGate } from "./packages/brain/src/impact-contract/diff-gate.js";
import { appendHop, nextHop } from "./packages/brain/src/orchestrator/decision-log.js";
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DB_URL });
const fx = JSON.parse(readFileSync("sprints/08161913-kernel-8f826ee6/tests/fixtures/d1360a48-radius.json", "utf8"));
const gate = await evaluateDiffGate({ repo: "cecelia", changedFiles: fx.changed_files, mapClient: async () => fx.radius_response });
if (gate.gate !== "blocked" || gate.reason !== "impact_anchor_missing" || gate.retryable !== false) {
  console.error("FAIL gate:", JSON.stringify(gate)); process.exit(1);
}
const receipt = { stage: "diff", gate: gate.gate, reason: gate.reason, retryable: gate.retryable, detail: gate.detail };
const runId = process.env.RUN_ID;
await pool.query("INSERT INTO initiative_runs (id, initiative_id, phase) VALUES ($1, $2, $3)", [runId, randomUUID(), "evaluate"]);
const hop = await nextHop(pool, runId);
await appendHop(pool, { runId, hop, observed: { source: "final-e2e" }, derivedPhase: "evaluate", gateVerdict: "deny:impact:" + gate.reason, action: "spawn:evaluator", detail: { impact_gate: receipt } });
await pool.end();
console.log("appended run", runId, "hop", hop);
' || { echo "FAIL: appendHop 写入失败"; exit 1; }

# 4. psql 校验新增行：确定性 verdict + retryable=false + unclaimed_files 非空（5 分钟时间窗防造假）
ROW=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='$RUN_ID' AND gate_verdict='deny:impact:impact_anchor_missing' AND (detail->'impact_gate'->>'retryable')='false' AND jsonb_array_length(detail->'impact_gate'->'detail'->'unclaimed_files') > 0 AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$ROW" -ge 1 ] || { echo "FAIL: orchestrator_decision_log 无确定性拦截行 (count=$ROW)"; exit 1; }

echo "✅ Golden Path 验证通过：确定性 impact 拦截落库 gate_verdict=deny:impact:impact_anchor_missing retryable=false unclaimed_files 非空"
