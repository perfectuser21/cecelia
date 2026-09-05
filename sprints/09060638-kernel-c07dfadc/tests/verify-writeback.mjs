// 自含回写验证器（真 Postgres）——DoD B-03/INV 与 E2E Step 4 复用。
// 自 seed 一份 active projection，验：存在 step 回写→passing 落库；缺失 step→skipped 不写脏；
// applyRunTerminalMaturity 终态锚接力。全程唯一 scope，finally 清理，无残留。
// RED：writebackStepMaturity/applyRunTerminalMaturity 未实现时抛错，exit 1。
import pgPkg from 'pg';
import { writebackStepMaturity } from '../../../packages/brain/src/lib/map-projection-store.js';
import { applyRunTerminalMaturity } from '../../../packages/brain/src/orchestrator/kernel-run-store.js';

const { Pool } = pgPkg;
const DB_URL = process.env.DB_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('FAIL: DB_URL/DATABASE_URL 未注入');
  process.exit(1);
}
const SCOPE = `ZVERIFY-${Date.now()}`;
const pool = new Pool({ connectionString: DB_URL });

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  throw new Error(msg);
}

async function seed() {
  await pool.query(`
    DO $$
    DECLARE d uuid; mvid uuid; runid uuid;
            dg text := encode(sha256(('${SCOPE}-manifest')::bytea),'hex');
            pjg text := encode(sha256(('${SCOPE}-proj')::bytea),'hex');
    BEGIN
      INSERT INTO decisions(category,topic,decision,reason,status)
        VALUES('judgment','writeback-verify-${SCOPE}','approved','verify seed','active') RETURNING id INTO d;
      INSERT INTO map_manifest_versions(scope_key,version,source_decision_id,manifest,digest,status,activated_at)
        VALUES('${SCOPE}',1,d, jsonb_build_object('scope_key','${SCOPE}','schema_version','1','source_decision_id',d::text), dg,'active',now())
        RETURNING id INTO mvid;
      INSERT INTO map_projection_runs(scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at)
        VALUES('${SCOPE}',mvid,dg,'{}'::jsonb,'map-projector-v1',pjg,'active',now()) RETURNING id INTO runid;
      INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name,attributes)
        VALUES(runid, encode(sha256(('${SCOPE}:stage:step-1')::bytea),'hex'),'stage','step-1','步骤1',
               jsonb_build_object('canvas_layer','stage','order_no',1,'maturity','unknown'));
    END $$;
  `);
}

async function maturity(stepKey) {
  const { rows } = await pool.query(
    `SELECT n.attributes->>'maturity' AS m
       FROM map_projection_nodes n JOIN map_projection_runs r ON r.id=n.run_id
      WHERE r.scope_key=$1 AND r.status='active' AND n.node_type='stage' AND n.node_key=$2`,
    [SCOPE, stepKey],
  );
  return rows[0]?.m ?? null;
}

async function stageCount() {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS c FROM map_projection_nodes n JOIN map_projection_runs r ON r.id=n.run_id
      WHERE r.scope_key=$1 AND r.status='active' AND n.node_type='stage'`,
    [SCOPE],
  );
  return rows[0].c;
}

async function cleanup() {
  await pool.query('DELETE FROM map_projection_runs WHERE scope_key=$1', [SCOPE]).catch(() => {});
  await pool.query('DELETE FROM map_manifest_versions WHERE scope_key=$1', [SCOPE]).catch(() => {});
  await pool.query('DELETE FROM decisions WHERE topic=$1', [`writeback-verify-${SCOPE}`]).catch(() => {});
  await pool.end().catch(() => {});
}

try {
  await seed();

  // 1) 存在 step 回写 → passing 落库
  let c = await pool.connect();
  await c.query('BEGIN');
  const up = await writebackStepMaturity(c, { scopeKey: SCOPE, stepKey: 'step-1', outcome: 'done' });
  await c.query('COMMIT');
  c.release();
  if (!up.updated || up.skipped) fail(`existing step writeback 未落 updated: ${JSON.stringify(up)}`);
  if ((await maturity('step-1')) !== 'passing') fail('existing step maturity 未变 passing');

  // 2) 缺失 step → skipped 不写脏
  const before = await stageCount();
  c = await pool.connect();
  await c.query('BEGIN');
  const skip = await writebackStepMaturity(c, { scopeKey: SCOPE, stepKey: 'ghost', outcome: 'failed' });
  await c.query('COMMIT');
  c.release();
  if (!skip.skipped || skip.updated) fail(`missing step 未 skipped: ${JSON.stringify(skip)}`);
  if ((await stageCount()) !== before) fail('missing step 造成脏写（行数变化）');

  // 3) 终态锚接力
  c = await pool.connect();
  await c.query('BEGIN');
  const relay = await applyRunTerminalMaturity(c, { task: { payload: { map_scope: [SCOPE], gp_step_key: 'step-1' } }, outcome: 'failed' });
  const noAnchor = await applyRunTerminalMaturity(c, { task: { payload: {} }, outcome: 'done' });
  await c.query('COMMIT');
  c.release();
  if (!relay.updated) fail('applyRunTerminalMaturity 锚齐备未回写');
  if (!noAnchor.skipped || noAnchor.reason !== 'no_anchor') fail('applyRunTerminalMaturity 锚缺失未跳过');
  if ((await maturity('step-1')) !== 'failing') fail('终态接力后 maturity 未变 failing');

  console.log('OK');
  await cleanup();
  process.exit(0);
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  await cleanup();
  process.exit(1);
}
