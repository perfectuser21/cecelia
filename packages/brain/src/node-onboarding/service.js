import { randomUUID } from 'node:crypto';
import { clearMachineCache } from '../routing/load-machines.js';
import {
  buildOnboardingScript, enrollmentError, onboardingView, requestHash, validateEnrollment,
  validateReceipt,
} from './spec.js';

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const META = "payload->'node_onboarding'";
const PROBE_INTERVAL_MS = 120_000;
const taskCreator = async args => (await import('../actions.js')).createTask(args);

export function createOnboardingService({ pool, createTask = taskCreator, config = {}, now = () => new Date() }) {
  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async function lock(db, key) {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`node-onboarding:${key}`]);
  }

  async function latest(db, id, mode = 'enroll') {
    if (!UUID.test(id)) throw enrollmentError('接入记录不存在', 404);
    const { rows } = await db.query(
      `SELECT * FROM tasks WHERE ${META}->>'id'=$1 AND ${META}->>'mode'=$2
       ORDER BY created_at DESC,id DESC LIMIT 1`, [id, mode]);
    if (!rows[0]) throw enrollmentError('接入记录不存在', 404);
    return rows[0];
  }

  async function enqueue(db, meta, attempt = 0) {
    const script = buildOnboardingScript(meta.id, meta.request, meta.mode, config);
    const result = await createTask({
      db, task_type: 'script_run', title: `${meta.mode === 'enroll' ? '接入机器' : '采集节点健康'}：${meta.request.name}（${meta.id}/${attempt}）`,
      description: '确定性节点管理；以受信 SSH 健康回执为验收依据，不调用模型，不执行任意清理。',
      priority: 'P2', allow_unscoped: true, source: 'api',
      source_id: `node-onboarding:${meta.id}:${meta.mode}:${attempt}`,
      executor_kind: 'script', trigger_source: 'node_onboarding',
      payload: { ...script, node_onboarding: { ...meta, attempt, reconciled: false } },
    });
    if (!result?.success || !result.task?.id) throw enrollmentError('接入任务未能登记', 503);
    return result.task;
  }

  async function create(input, key) {
    const request = validateEnrollment(input);
    if (!UUID.test(key || '')) throw enrollmentError('需要有效的 Idempotency-Key');
    const hash = requestHash(request);
    const task = await transaction(async db => {
      // 幂等键与目标地址各自串行化，避免不同名称抢同一个目标。
      await lock(db, `key:${key}`);
      for (const value of [`name:${request.name}`, `address:${request.address}:${request.ssh_port}`].sort()) await lock(db, value);
      const { rows: seen } = await db.query(
        `SELECT * FROM tasks WHERE ${META}->>'idempotency_key'=$1 ORDER BY created_at DESC LIMIT 1`, [key]);
      if (seen[0]) {
        if (seen[0].payload.node_onboarding.request_hash !== hash) throw enrollmentError('同一提交标识不能更换接入信息', 409);
        return latest(db, seen[0].payload.node_onboarding.id);
      }
      const { rows: pending } = await db.query(
        `SELECT * FROM tasks WHERE ${META}->>'mode'='enroll' AND
         (${META}->'request'->>'name'=$1 OR (${META}->'request'->>'address'=$2 AND ${META}->'request'->>'ssh_port'=$3))
         ORDER BY created_at DESC LIMIT 1`, [request.name, request.address, String(request.ssh_port)]);
      const { rows: existing } = await db.query(
        `SELECT id FROM system_registry WHERE type='machine' AND
         (name=$1 OR metadata->>'tailscale_ip'=$2 OR metadata->>'address'=$2) LIMIT 1`, [request.name, request.address]);
      if (pending[0]) {
        const previous = pending[0];
        const meta = previous.payload.node_onboarding;
        if (meta.request_hash === hash) return previous;
        if (existing.length || !['failed', 'cancelled'].includes(onboardingView(previous, now()).status)) {
          throw enrollmentError('名称或地址已有接入记录，请查看原接入记录', 409);
        }
        await lock(db, meta.id);
        const current = await latest(db, meta.id);
        if (current.id !== previous.id) throw enrollmentError('接入状态已变化，请刷新后重试', 409);
        return enqueue(db, { ...meta, request, request_hash: hash, idempotency_key: key,
          registration_error: null, retry_of_task_id: previous.id }, (meta.attempt || 0) + 1);
      }
      if (existing.length) throw enrollmentError('该机器已在设备台账中，请使用现有设备记录', 409);
      return enqueue(db, { id: randomUUID(), mode: 'enroll', request,
        idempotency_key: key, request_hash: hash });
    });
    return get(task.payload.node_onboarding.id);
  }

  async function reconcileTask(db, row) {
    const meta = row.payload.node_onboarding;
    if (meta.reconciled || !['completed', 'completed_no_pr', 'failed', 'cancelled'].includes(row.status)) return;
    let receipt;
    if (['completed', 'completed_no_pr'].includes(row.status)) {
      try { receipt = validateReceipt(row, row.completed_at || now()); }
      catch { /* 校验失败仍记下对账结果，不能把设备升级成 active。 */ }
    }
    if (receipt && meta.mode === 'enroll') {
      const metadata = {
        address: meta.request.address, physical_location: meta.request.region,
        hardware: receipt.health.os === 'darwin' ? 'Mac 节点' : 'Linux 节点',
        role: meta.request.role, executors: [], services: [],
        node_health: receipt.health,
        onboarding: { id: meta.id, request: meta.request, task_id: row.id, state: 'managed',
          managed_at: now().toISOString(), next_probe_at: new Date(now().getTime() + PROBE_INTERVAL_MS).toISOString() },
      };
      const result = await db.query(
        `INSERT INTO system_registry(id,type,name,description,status,metadata)
         VALUES($1,'machine',$2,'通过受信 SSH 接入的监控节点','active',$3)
         ON CONFLICT(type,name) DO UPDATE SET updated_at=now()
         WHERE system_registry.metadata->'onboarding'->>'id'=$1::text RETURNING id`,
        [meta.id, meta.request.name, JSON.stringify(metadata)]);
      if (!result.rows.length) {
        meta.registration_error = 'name_conflict';
        await db.query(`UPDATE tasks SET payload=jsonb_set(payload,'{node_onboarding,registration_error}','"name_conflict"') WHERE id=$1`, [row.id]);
      }
      clearMachineCache();
    } else if (meta.mode === 'sample') {
      // 旧回执不得覆盖更新样本；失败保留上次健康数据，由时间戳将节点降为 stale。
      if (receipt) {
        await db.query(
          `UPDATE system_registry SET metadata=jsonb_set(metadata,'{node_health}',$2::jsonb),updated_at=now()
           WHERE type='machine' AND metadata->'onboarding'->>'id'=$1
           AND COALESCE((metadata->'node_health'->>'observed_at')::timestamptz,'epoch'::timestamptz)<$3::timestamptz`,
          [meta.id, JSON.stringify(receipt.health), receipt.health.observed_at]);
      }
    }
    await db.query(
      `UPDATE tasks SET payload=jsonb_set(payload,'{node_onboarding,reconciled}','true'::jsonb),updated_at=now() WHERE id=$1`, [row.id]);
  }

  async function reconcile() {
    const { rows } = await pool.query(
      `SELECT id FROM tasks WHERE ${META} IS NOT NULL
       AND COALESCE(${META}->>'reconciled','false')='false'
       AND status IN ('completed','completed_no_pr','failed','cancelled') ORDER BY created_at LIMIT 50`);
    let applied = 0; let errors = 0;
    for (const row of rows) {
      try { await transaction(async db => {
        const { rows: locked } = await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [row.id]);
        if (locked[0]) { await reconcileTask(db, locked[0]); applied++; }
      }); } catch { errors++; }
    }
    return { reconciled: applied, errors };
  }

  async function get(id) {
    return transaction(async db => {
      await lock(db, id);
      const task = await latest(db, id);
      await reconcileTask(db, task);
      return onboardingView(task, now());
    });
  }

  async function list() {
    await reconcile();
    const { rows } = await pool.query(
      `SELECT * FROM (SELECT DISTINCT ON (${META}->>'id') * FROM tasks WHERE ${META}->>'mode'='enroll'
       ORDER BY ${META}->>'id',created_at DESC,id DESC) AS latest ORDER BY created_at DESC,id DESC LIMIT 100`);
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { items: rows.map(row => onboardingView(row, now())) };
  }

  async function retry(id) {
    return transaction(async db => {
      await lock(db, id);
      const previous = await latest(db, id);
      if (!['failed', 'cancelled'].includes(onboardingView(previous, now()).status)) throw enrollmentError('进行中或已完成的接入不能重复启动', 409);
      const meta = previous.payload.node_onboarding;
      const task = await enqueue(db, { ...meta, registration_error: null, retry_of_task_id: previous.id }, (meta.attempt || 0) + 1);
      return onboardingView(task, now());
    });
  }

  async function scheduleProbes() {
    const { rows } = await pool.query(
      `SELECT id FROM system_registry WHERE type='machine' AND status='active'
       AND metadata->'onboarding'->>'state'='managed'
       AND COALESCE(metadata->'onboarding'->>'next_probe_at','')<$1
       AND NOT EXISTS (SELECT 1 FROM tasks WHERE payload->'node_onboarding'->>'id'=system_registry.metadata->'onboarding'->>'id'
         AND payload->'node_onboarding'->>'mode'='sample' AND status IN ('queued','in_progress','blocked'))
       ORDER BY updated_at LIMIT 3`, [now().toISOString()]);
    let scheduled = 0;
    for (const row of rows) {
      await transaction(async db => {
        await lock(db, `probe:${row.id}`);
        const { rows: machines } = await db.query('SELECT * FROM system_registry WHERE id=$1 FOR UPDATE', [row.id]);
        const meta = machines[0]?.metadata?.onboarding;
        if (!meta || new Date(meta.next_probe_at) > now()) return;
        const { rows: active } = await db.query(
          `SELECT id FROM tasks WHERE ${META}->>'id'=$1 AND ${META}->>'mode'='sample'
           AND status IN ('queued','in_progress','blocked') LIMIT 1`, [meta.id]);
        if (active.length) return;
        await enqueue(db, { id: meta.id, request: meta.request, mode: 'sample' }, now().getTime());
        await db.query(
          `UPDATE system_registry SET metadata=jsonb_set(metadata,'{onboarding,next_probe_at}',$2::jsonb) WHERE id=$1`,
          [row.id, JSON.stringify(new Date(now().getTime() + PROBE_INTERVAL_MS).toISOString())]);
        scheduled++;
      });
    }
    return { scheduled };
  }
  return { create, get, list, retry, reconcile, scheduleProbes };
}

export async function runNodeOnboardingJob(pool) {
  const service = createOnboardingService({ pool });
  return { ...await service.reconcile(), ...await service.scheduleProbes() };
}
