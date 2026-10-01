import { randomUUID, createHash } from 'node:crypto';
import { PREVIEW_CACHE_AUTHORITY, PREVIEW_CACHE_POLICY as POLICY } from './preview-cache-authority.js';
import { createPreviewCacheClient } from './preview-cache-client.js';
import { finalizeTask, afterTerminalTransition } from './lib/task-terminal.js';
const taskCreator = async (args, internal) => (await import('./actions.js')).createTask(args, internal);
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const FIELDS = ['policy', 'resource_id', 'generation', 'task_id', 'intent_id', 'expires_at'];
const digest = request => createHash('sha256').update(JSON.stringify(FIELDS.map(k => request[k]))).digest('hex');
const unknown = () => ({ status: 'unconfirmed' });
export function createPreviewCacheController({ pool, client = createPreviewCacheClient(), createTask = taskCreator } = {}) {
  async function transaction(fn) {
    const db = await pool.connect();
    try { await db.query('BEGIN'); const value = await fn(db); await db.query('COMMIT'); return value; }
    catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
  }
  async function claim(candidate, runId) {
    const r = candidate?.request;
    if (candidate?.machine !== 'mmv' || r?.policy !== POLICY || !UUID.test(r.resource_id)
        || !Number.isSafeInteger(r.generation) || r.generation < 1 || !Number.isFinite(Date.parse(r.expires_at))) throw new Error('INVALID_CACHE_PLAN');
    const source = `${POLICY}:mmv:${r.resource_id}:${r.generation}`;
    return transaction(async db => {
      // 独立source锁/唯一表跨router_version保留task与intent，不能先SELECT再认领。
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [source]);
      const old = (await db.query('SELECT * FROM janitor_cache_intents WHERE source_id=$1', [source])).rows[0];
      if (old) return { ...old, fresh: false };
      const made = await createTask({ db, title: `回收 MMV preview 专属缓存 ${r.resource_id}`,
        description: '固定策略删除已过期的自有 npm cache，以preview-agent持久回执及目录缺失复验为验收。',
        task_type: 'janitor', executor_kind: 'preview-janitor', status: 'blocked', blocked_at: new Date(),
        source: 'scheduler', source_id: source, trigger_source: 'janitor_scheduler', allow_unscoped: true,
        mutation_intent: 'write', declared_domain: 'operations', priority: 'P2',
        payload: { policy: POLICY, machine: 'mmv', source_id: source },
      }, { previewCacheAuthority: PREVIEW_CACHE_AUTHORITY });
      if (!made?.success || !made.task?.id) throw new Error('TASK_CREATE_FAILED');
      const taskId = made.task.id; const request = { policy: POLICY, resource_id: r.resource_id, generation: r.generation,
        task_id: taskId, intent_id: randomUUID(), expires_at: r.expires_at };
      const claimant = `janitor:${request.intent_id}`;
      const row = (await db.query(`INSERT INTO janitor_cache_intents(source_id,task_id,run_id,request,digest,claimant)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [source, taskId, runId, JSON.stringify(request), digest(request), claimant])).rows[0];
      await db.query(`UPDATE tasks SET status='in_progress',claimed_by=$2,claimed_at=now(),started_at=now(),blocked_at=NULL,
        updated_at=now() WHERE id=$1 AND status='blocked'`, [taskId, claimant]);
      return { ...row, fresh: true };
    });
  }
  function verified(row, receipt) {
    return receipt?.status === 'success' && receipt.actor === 'preview-agent:mmv' && receipt.policy_version === POLICY
      && FIELDS.every(k => receipt[k] === row.request[k]) && receipt.digest === row.digest
      && receipt.identity?.resource_id === row.request.resource_id && receipt.identity?.generation === row.request.generation
      && receipt.identity?.machine === 'mmv' && receipt.identity?.repo === 'perfectuser21/cecelia'
      && receipt.evidence?.absent === true && receipt.evidence.dev === receipt.identity.dev && receipt.evidence.ino === receipt.identity.ino
      && [receipt.before, receipt.after].every(s => Number.isSafeInteger(s?.available_bytes) && s.available_bytes >= 0
        && Number.isSafeInteger(s?.total_bytes) && s.total_bytes > 0 && Number.isFinite(Date.parse(s.observed_at)));
  }
  async function settle(row, receipt) {
    if (!verified(row, receipt)) return unknown();
    const changed = await transaction(async db => {
      const current = (await db.query('SELECT * FROM janitor_cache_intents WHERE source_id=$1 FOR UPDATE', [row.source_id])).rows[0];
      if (current.settled_at) return false;
      if (current.digest !== row.digest) throw new Error('INTENT_CONFLICT');
      const result = await finalizeTask(db, row.task_id, 'completed', { relay: false,
        onlyIfStatus: ['in_progress', 'blocked'], where: { sql: 'claimed_by=$1', params: [row.claimant] },
        mergeResult: { fact: '专属npm cache精确目录已不存在，删除前后真实磁盘采样已复验', actor: receipt.actor, receipt,
          handoff: { schema_version: 1, summary: '固定专属cache过期回收完成', next_steps: [] } },
      });
      if (result.rowCount !== 1) throw new Error('TASK_OWNERSHIP_CHANGED');
      await db.query('UPDATE janitor_cache_intents SET receipt=$2,settled_at=now() WHERE source_id=$1', [row.source_id, JSON.stringify(receipt)]);
      return true;
    });
    if (changed) await afterTerminalTransition(pool, row.task_id, 'completed');
    return { status: 'success', freed_bytes: Math.max(0, receipt.after.available_bytes - receipt.before.available_bytes) };
  }
  async function block(row) {
    await pool.query(`UPDATE tasks SET status='blocked',blocked_at=COALESCE(blocked_at,now()),updated_at=now(),
      error_message='PREVIEW_CACHE_UNCONFIRMED' WHERE id=$1 AND claimed_by=$2 AND status='in_progress'`, [row.task_id, row.claimant]);
  }
  async function run({ run_id, signal }) {
    const plan = await client.plan(signal);
    if (plan?.policy !== POLICY || !Array.isArray(plan.resources)) throw new Error('INVALID_CACHE_PLAN');
    if (!plan.resources.length) return { status: 'skipped', freed_bytes: 0 };
    let row;
    try { row = await claim(plan.resources[0], run_id); } catch { return unknown(); }
    if (!row.fresh) return row.settled_at ? { status: 'skipped', freed_bytes: 0 } : unknown();
    try {
      signal?.throwIfAborted();
      await client.execute(row.request, signal);
      // POST成功仍读持久回执；不凭传输成功、exit=0或任务payload结算。
      const result = await settle(row, await client.receipt(row.request.intent_id, signal));
      if (result.status === 'unconfirmed') await block(row);
      return result;
    } catch { await block(row).catch(() => {}); return unknown(); }
  }
  async function reconcile({ run_id, signal }) {
    const rows = (await pool.query('SELECT * FROM janitor_cache_intents WHERE run_id=$1', [run_id])).rows;
    if (rows.length !== 1) return unknown();
    try { return await settle(rows[0], await client.receipt(rows[0].request.intent_id, signal)); }
    catch { return unknown(); }
  }
  return Object.freeze({ claim, run, reconcile });
}
export const previewCacheJob = Object.freeze({ JOB_ID: POLICY, JOB_NAME: 'MMV preview 专属 npm cache 过期回收',
  run: context => createPreviewCacheController({ pool: context.pool }).run(context),
  reconcile: context => createPreviewCacheController({ pool: context.pool }).reconcile(context),
});
