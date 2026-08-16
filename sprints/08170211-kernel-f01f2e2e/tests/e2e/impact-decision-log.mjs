/**
 * Final E2E 助手（数据写入类 · local_api · 需 ${DB_URL} scratch 库）
 *
 * 目的：用真实 evaluateDiffGate（被改的分类逻辑）+ 真实 harness-gates beforeEvaluate（被改的
 * gateReceipt 透传）产出确定性 impact 结论，按 loop.js 口径算出 gateVerdict，经真实 appendHop
 * 写入 orchestrator_decision_log（真 DB 写路径，不 mock 被改的边），再回读断言。
 * radius/mapper 响应用会话独享录制夹具注入（radius.js 不在本单改动范围，属外层边界）。
 *
 * 用法：DB_URL=postgres://... node sprints/08170211-kernel-f01f2e2e/tests/e2e/impact-decision-log.mjs
 * 退出码 0 = 通过；非 0 = 失败（stdout 打印 FAIL 原因）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DB_URL = process.env.DB_URL || process.env.DATABASE_URL;
if (!DB_URL) { console.error('FAIL: DB_URL/DATABASE_URL 未注入'); process.exit(1); }
process.env.DATABASE_URL = DB_URL;

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'run-d1360a48-radius.json'), 'utf8'),
);

const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);

const poolMod = await import('../../../../packages/brain/src/db.js');
const pool = poolMod.default;
const { evaluateDiffGate } = await import('../../../../packages/brain/src/impact-contract/diff-gate.js');
const { createHarnessImpactGates } = await import('../../../../packages/brain/src/impact-contract/harness-gates.js');
const { appendHop } = await import('../../../../packages/brain/src/orchestrator/decision-log.js');
const { seedOwnedActiveV2Run } = await import(
  '../../../../packages/brain/src/__tests__/integration/helpers/controller-authority-fixture.js'
);

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }

const taskId = randomUUID();
try {
  await pool.query(
    `INSERT INTO tasks (id, title, task_type, status, priority, payload)
     VALUES ($1, 'e2e impact anchor', 'dev', 'in_progress', 'P1', '{}')`,
    [taskId],
  );
  const { runId } = await seedOwnedActiveV2Run(pool, { taskId, phase: 'evaluate' });

  // 真实 harness-gates + 真实 diff-gate（注入 mapper 响应 = 外层 radius 边界）。
  const gates = createHarnessImpactGates({
    db: pool,
    getActiveContract: async () => ({
      id: 'e2e-contract', repo: 'cecelia', base_revision: BASE_SHA,
      contract_hash: 'e2e-hash', change_kind: 'code_change', contract_body: {},
    }),
    getGap: async () => null,
    readChangedFiles: async () => fixture.changed_files,
    diffGate: async ({ taskId: t, repo, headRevision, changedFiles }) => evaluateDiffGate({
      taskId: t, repo, headRevision, changedFiles, mapClient: async () => fixture,
    }),
  });
  const receipt = await gates.beforeEvaluate({
    task: { id: taskId, payload: {} },
    pr: { head_sha: HEAD_SHA },
    run: {},
  });

  if (receipt.gate !== 'blocked') fail(`receipt.gate=${receipt.gate}`);
  if (receipt.reason !== 'impact_anchor_missing') fail(`receipt.reason=${receipt.reason}`);
  if (receipt.retryable !== false) fail(`receipt.retryable=${receipt.retryable}`);
  if (!receipt.detail || !Array.isArray(receipt.detail.unclaimed_files) || receipt.detail.unclaimed_files.length === 0) {
    fail(`receipt.detail.unclaimed_files 空: ${JSON.stringify(receipt.detail)}`);
  }

  // loop.js 口径：非 pass/extend → gateVerdict = deny:impact:<reason>
  const gateVerdict = `deny:impact:${receipt.reason}`;
  await appendHop(pool, {
    runId, hop: 1,
    observed: { note: 'e2e beforeEvaluate deterministic impact' },
    derivedPhase: 'evaluate',
    gateVerdict,
    action: 'spawn:evaluator',
    detail: { impact_gate: receipt },
  });

  const { rows } = await pool.query(
    `SELECT gate_verdict, detail FROM orchestrator_decision_log WHERE run_id=$1 AND hop=1`,
    [runId],
  );
  if (rows.length !== 1) fail(`decision_log 行数=${rows.length}`);
  const row = rows[0];
  if (row.gate_verdict !== 'deny:impact:impact_anchor_missing') fail(`gate_verdict=${row.gate_verdict}`);
  const ig = row.detail?.impact_gate ?? {};
  if (ig.retryable !== false) fail(`detail.impact_gate.retryable=${ig.retryable}`);
  if (!Array.isArray(ig.detail?.unclaimed_files) || ig.detail.unclaimed_files.length === 0) {
    fail(`detail.impact_gate.detail.unclaimed_files 空: ${JSON.stringify(ig.detail)}`);
  }

  console.log('OK: orchestrator_decision_log 落行 deny:impact:impact_anchor_missing retryable=false unclaimed_files=' + JSON.stringify(ig.detail.unclaimed_files));
  process.exit(0);
} catch (err) {
  fail(err?.stack || String(err));
} finally {
  try { await pool.end(); } catch { /* noop */ }
}
