/**
 * Final E2E 驱动 — Diff Impact Gate 确定性 blocked 落 orchestrator_decision_log
 * target_environment=local_api（scratch Postgres，DB_URL 由 Fleet 注入）。
 *
 * 真调链（禁 mock 被改的边）：
 *   - 真 createHarnessImpactGates().beforeEvaluate（被改边 harness-gates）
 *   - 真 evaluateDiffGate（被改边 diff-gate），真 getActiveImpactContract（真 DB 读）
 *   - 真 appendHop（真 DB 写 orchestrator_decision_log）
 *   - 唯一 mock = 外层 mapper（map-client HTTP 边界；radius.js/map-client 本 sprint 不改，
 *     属允许的外层依赖 mock，见合同「## 未覆盖真实链路清单」第 1 条）
 *   - loop.js 的 gateVerdict 串拼（deny:impact:<reason>）与 detail.impact_gate 落盘
 *     按 loop.js:1453-1454/1514 原样复现（这两行本 sprint 不改），二者的 failure_class/
 *     退避路由由纯单测 derive-impact-deterministic-routing.test.ts 覆盖（清单第 2 条）。
 *
 * 退出码：0=成功；非 0=断言失败/环境未就绪。stdout 打印 RUN_ID=<uuid> 供 bash psql 复核。
 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { runMigrations } from '../../../packages/brain/src/migrate.js';
import { createHarnessImpactGates } from '../../../packages/brain/src/impact-contract/harness-gates.js';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { appendHop } from '../../../packages/brain/src/orchestrator/decision-log.js';

const DB_URL = process.env.DB_URL;
if (!DB_URL) {
  console.error('FAIL: DB_URL 必填（Fleet 注入的 attempt 级 scratch 库）');
  process.exit(1);
}

const HEAD = 'a'.repeat(40);
const pool = new pg.Pool({ connectionString: DB_URL });

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

async function main() {
  // 1. 空库跑仓库真实 migration bootstrap，并机检目标表存在。
  await runMigrations(pool);
  const tableCheck = await pool.query(
    "SELECT to_regclass('public.orchestrator_decision_log') IS NOT NULL AS ok",
  );
  if (!tableCheck.rows[0]?.ok) return fail('migration 后 orchestrator_decision_log 不存在');

  // 2. 种子：task + active impact contract + run（orchestrator_decision_log.run_id FK）。
  const taskId = randomUUID();
  const initiativeId = randomUUID();
  const runId = randomUUID();
  await pool.query(
    `INSERT INTO tasks (id, title, task_type, status, priority, payload)
     VALUES ($1, 'e2e impact gate deterministic', 'harness_initiative', 'in_progress', 'P2', '{}'::jsonb)`,
    [taskId],
  );
  await pool.query(
    `INSERT INTO harness_impact_contracts (
       task_id, version, status, schema_version, change_kind, repo,
       base_revision, manifest_digest, projection_digest, contract_hash, contract_body
     ) VALUES ($1, 1, 'active', 1, 'bugfix', 'perfectuser21/cecelia',
       $2, $3, $4, $5, $6::jsonb)`,
    [
      taskId, HEAD, '1'.repeat(64), '2'.repeat(64), '3'.repeat(64),
      JSON.stringify({ affected_capabilities: [{ capability_id: 'G1' }], required_assertions: [] }),
    ],
  );
  await pool.query(
    'INSERT INTO initiative_runs (id, initiative_id) VALUES ($1, $2)',
    [runId, initiativeId],
  );

  // 3. 真闸：只把外层 mapper 注入进真 diff-gate（返回确定性 impact_anchor_missing）。
  const mapper = async () => ({
    freshness: { status: 'unknown', reason_code: 'impact_anchor_missing', checked_at: new Date().toISOString() },
    fact_revisions: { 'perfectuser21/cecelia': HEAD },
    affected_nodes: [{ capability_id: 'G1' }],
    required_assertions: [],
    unclaimed_files: ['DoD.md'],
  });
  const gates = createHarnessImpactGates({
    db: pool,
    diffGate: (args) => evaluateDiffGate({ ...args, mapClient: mapper }),
  });
  const receipt = await gates.beforeEvaluate({
    task: { id: taskId, payload: {} },
    pr: { head_sha: HEAD, type: 'git_candidate', verification_status: 'verified', changed_files: ['DoD.md'] },
    run: { id: runId },
  });

  if (receipt.reason !== 'impact_anchor_missing') return fail(`receipt.reason=${receipt.reason} 期望 impact_anchor_missing`);
  if (receipt.retryable !== false) return fail(`receipt.retryable=${receipt.retryable} 期望 false`);
  const unclaimed = receipt.detail?.unclaimed_files;
  if (!Array.isArray(unclaimed) || unclaimed.length < 1) return fail('receipt.detail.unclaimed_files 为空');

  // 4. 真写决策日志（复现 loop.js:1453-1454/1514 未改逻辑：gateVerdict 串 + detail.impact_gate）。
  const gateVerdict = ['pass', 'extend'].includes(receipt.gate) ? 'allow' : `deny:impact:${receipt.reason}`;
  await appendHop(pool, {
    runId,
    hop: 1,
    observed: { head_sha: HEAD, source: 'e2e-impact-gate-decision-log' },
    derivedPhase: 'evaluate',
    gateVerdict,
    action: 'spawn:evaluator',
    detail: { reason: 'no_evaluate_verdict_for_head_sha', impact_gate: receipt },
  });

  console.log(`RUN_ID=${runId}`);
  console.log('OK: 确定性 impact 结论已落 orchestrator_decision_log');
}

main()
  .catch((err) => { fail(err?.stack ?? String(err)); })
  .finally(async () => { await pool.end().catch(() => {}); });
