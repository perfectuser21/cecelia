import { randomUUID, createHash } from 'node:crypto';
import { IMAGE_RETENTION_AUTHORITY, IMAGE_RETENTION_POLICY as POLICY, IMAGE_RETENTION_MACHINE as MACHINE } from './image-retention-authority.js';
import { loadImageRetentionEngine } from './image-retention-runtime.js';
import { finalizeTask, afterTerminalTransition } from './lib/task-terminal.js';
const taskCreator = async (args, internal) => (await import('./actions.js')).createTask(args, internal);
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const IMAGE = /^sha256:[a-f0-9]{64}$/;
const FIELDS = ['run_id', 'image_id', 'intent_id', 'task_id'];
const identityFields = ['machine_registry_id', 'daemon_id', 'docker_root_dir', 'volume_dev'];
const canonical = value => Object.fromEntries(FIELDS.map(key => [key, value[key]]));
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const unknown = () => ({ status: 'unconfirmed' });
export function createImageRetentionController({ pool, engine, createTask = taskCreator } = {}) {
  const runtime = async () => engine ?? loadImageRetentionEngine();
  async function transaction(fn) {
    const db = await pool.connect();
    try { await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result; }
    catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
  }
  async function claim(plan, imageId) {
    if (plan?.policy !== POLICY || !UUID.test(plan.run_id) || plan.identity?.machine_registry_id !== MACHINE
        || !plan.identity.daemon_id || typeof plan.identity.docker_root_dir !== 'string' || !Number.isSafeInteger(plan.identity.volume_dev)
        || !Array.isArray(plan.images) || plan.images.length > 2 || !IMAGE.test(imageId) || !plan.images.some(x => x.id === imageId)) throw new Error('INVALID_IMAGE_PLAN');
    const source = `${POLICY}:${plan.run_id}:${imageId}`;
    return transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [source]);
      const old = (await db.query('SELECT * FROM janitor_image_intents WHERE source_id=$1', [source])).rows[0];
      if (old) return { ...old, fresh: false };
      const made = await createTask({ db, title: `回收 US 历史 Brain 镜像 ${imageId}`,
        description: '固定策略最多两项；完整镜像ID缺失及真实磁盘采样验收，未知结果保留原预约。',
        task_type: 'janitor', executor_kind: 'image-janitor', status: 'blocked', blocked_at: new Date(),
        source: 'scheduler', source_id: source, trigger_source: 'janitor_scheduler', allow_unscoped: true,
        mutation_intent: 'write', declared_domain: 'operations', priority: 'P2',
        payload: { policy: POLICY, machine_registry_id: MACHINE, source_id: source },
      }, { imageRetentionAuthority: IMAGE_RETENTION_AUTHORITY });
      if (!made?.success || !UUID.test(made.task?.id)) throw new Error('TASK_CREATE_FAILED');
      const body = { run_id: plan.run_id, image_id: imageId, intent_id: randomUUID(), task_id: made.task.id };
      const claimant = `janitor:${body.intent_id}`;
      const row = (await db.query(`INSERT INTO janitor_image_intents(source_id,task_id,run_id,request,binding,digest,claimant)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [source, body.task_id, body.run_id, JSON.stringify(body), JSON.stringify(plan.identity), digest(body), claimant])).rows[0];
      const updated = await db.query(`UPDATE tasks SET status='in_progress',claimed_by=$2,claimed_at=now(),started_at=now(),blocked_at=NULL,
        updated_at=now() WHERE id=$1 AND status='blocked'`, [body.task_id, claimant]);
      if (updated.rowCount !== 1) throw new Error('TASK_OWNERSHIP_CHANGED');
      return { ...row, fresh: true };
    });
  }
  function verified(row, receipt) {
    if (!['success', 'skipped'].includes(receipt?.status) || receipt.actor !== 'janitor:us-brain-image-retention' || receipt.policy !== POLICY
        || !FIELDS.every(key => receipt[key] === row.request[key]) || receipt.digest !== row.digest
        || !identityFields.every(key => receipt.identity?.[key] === row.binding[key]) || !Number.isFinite(Date.parse(receipt.confirmed_at))) return false;
    if (receipt.status === 'skipped') return receipt.attempted === false && typeof receipt.reason === 'string';
    return receipt.attempted === true && receipt.evidence?.absent === true && receipt.evidence.image_id === row.request.image_id
      && [receipt.before, receipt.after].every(x => Number.isSafeInteger(x?.total_bytes) && x.total_bytes > 0
        && Number.isSafeInteger(x.available_bytes) && x.available_bytes >= 0 && x.available_bytes <= x.total_bytes && Number.isFinite(Date.parse(x.observed_at)));
  }
  async function settle(row, receipt) {
    if (!verified(row, receipt)) return unknown();
    const terminal = receipt.status === 'success' ? 'completed' : 'failed';
    const changed = await transaction(async db => {
      const current = (await db.query('SELECT * FROM janitor_image_intents WHERE source_id=$1 FOR UPDATE', [row.source_id])).rows[0];
      if (!current || current.digest !== row.digest) throw new Error('INTENT_CONFLICT');
      if (current.settled_at) return false;
      const result = await finalizeTask(db, row.task_id, terminal, { relay: false, onlyIfStatus: ['in_progress', 'blocked'],
        where: { sql: 'claimed_by=$1', params: [row.claimant] },
        mergeResult: { fact: receipt.status === 'success' ? '完整镜像ID已不存在，删除前后实际数据卷容量已复验' : '最终资源或部署保护闸拒绝，本intent未执行删除',
          actor: receipt.actor, receipt, handoff: { schema_version: 1, summary: 'US固定镜像策略回执已核验', next_steps: [] } },
      });
      if (result.rowCount !== 1) throw new Error('TASK_OWNERSHIP_CHANGED');
      await db.query('UPDATE janitor_image_intents SET receipt=$2,settled_at=now() WHERE source_id=$1', [row.source_id, JSON.stringify(receipt)]);
      return true;
    });
    if (changed) await afterTerminalTransition(pool, row.task_id, terminal);
    return { status: receipt.status };
  }
  async function block(row) {
    await pool.query(`UPDATE tasks SET status='blocked',blocked_at=COALESCE(blocked_at,now()),updated_at=now(),
      error_message='IMAGE_RETENTION_UNCONFIRMED' WHERE id=$1 AND claimed_by=$2 AND status='in_progress'`, [row.task_id, row.claimant]);
  }
  async function run({ run_id, signal }) {
    let client, row;
    try {
      client = await runtime(); if (!client) return { status: 'skipped', freed_bytes: 0 };
      const plan = await client.plan(run_id);
      for (const candidate of plan.images) {
        signal?.throwIfAborted(); row = await claim(plan, candidate.id);
        if (!row.fresh) return unknown();
        signal?.throwIfAborted(); await client.execute(row.request);
        if ((await settle(row, await client.receipt(row.request.intent_id))).status === 'unconfirmed') { await block(row); return unknown(); }
        row = null;
      }
      return await client.finishPlan(run_id);
    } catch { if (row) await block(row).catch(() => {}); return unknown(); }
  }
  async function reconcile({ run_id, signal }) {
    try {
      const client = await runtime(); if (!client) return unknown();
      const rows = (await pool.query('SELECT * FROM janitor_image_intents WHERE run_id=$1 ORDER BY created_at', [run_id])).rows;
      if (rows.length > 2) return unknown();
      for (const row of rows) {
        signal?.throwIfAborted();
        const receipt = await client.receipt(row.request.intent_id) ?? await client.recover(row.request);
        if ((await settle(row, receipt)).status === 'unconfirmed') { await block(row); return unknown(); }
      }
      return await client.finishPlan(run_id);
    } catch { return unknown(); }
  }
  return Object.freeze({ claim, run, reconcile });
}
export const imageRetentionJob = Object.freeze({ JOB_ID: POLICY, JOB_NAME: 'US 历史 Brain 镜像保留清理',
  run: context => createImageRetentionController({ pool: context.pool }).run(context),
  reconcile: context => createImageRetentionController({ pool: context.pool }).reconcile(context),
});
