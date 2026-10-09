import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFile, mkdtemp, realpath, mkdir, writeFile, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import { fileURLToPath } from 'node:url';
import janitorRouter from '../../routes/janitor.js';
import { createIntakeTestDatabase } from '../fixtures/task-intake-db.js';
import { createJanitor } from '../../janitor.js';
import { createCacheService, POLICY } from '../../../../../scripts/preview-cache/service.mjs';
import { createCacheRouter } from '../../../../../scripts/preview-cache/router.mjs';
let fixture, pool, createPreviewCacheController, createPreviewCacheClient;
const exec = promisify(execFile);
beforeAll(async () => {
  ({ createPreviewCacheController } = await import('../../preview-cache-controller.js').catch(() => ({})));
  ({ createPreviewCacheClient } = await import('../../preview-cache-client.js').catch(() => ({})));
  expect(createPreviewCacheController, '缺少真实账controller').toBeTypeOf('function');
  fixture = await createIntakeTestDatabase(); pool = fixture.pool;
  await pool.query(await readFile(new URL('../../../migrations/272_janitor.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../../../migrations/502_preview_owned_cache_janitor.sql', import.meta.url), 'utf8'));
});
afterAll(async () => fixture?.close());
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'janitor-pg-')));
  const pkg = join(root, 'npm-fixture'); await mkdir(pkg);
  await writeFile(join(pkg, 'package.json'), '{"name":"preview-owned-cache","version":"1.0.0"}');
  await exec('npm', ['install', '--package-lock-only', '--offline', '--ignore-scripts', '--cache', join(pkg, '.bootstrap-cache')], { cwd: pkg });
  let time = Date.now(); let executions = 0; let loseResponse = false;
  const service = createCacheService({ root, now: () => time,
    github: async () => ({ state: 'CLOSED', closedAt: '2020-01-01T00:00:00Z', mergedAt: null,
      headRefOid: 'a'.repeat(40), updatedAt: '2020-01-01T00:00:00Z', url: 'https://github.com/perfectuser21/cecelia/pull/42' }) });
  await service.withWriter('42', cache => exec('npm', ['ci', '--cache', cache, '--offline', '--ignore-scripts'], { cwd: pkg }));
  time += 2 * 86400000;
  const app = express(); app.use(express.json());
  app.use('/api/brain/preview/janitor/cache', createCacheRouter({ token: 'fixture', service: { ...service,
    execute: async input => {
      executions++;
      const row = (await pool.query('SELECT status FROM tasks WHERE id=$1', [input.task_id])).rows[0];
      expect(row.status).toBe('in_progress');
      const receipt = await service.execute(input); if (loseResponse) throw Error('connection-lost'); return receipt;
    } } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const transport = createPreviewCacheClient({ token: 'fixture', base: `http://127.0.0.1:${server.address().port}` });
  const controller = createPreviewCacheController({ pool, client: transport });
  const api = createJanitor([{ JOB_ID: POLICY, JOB_NAME: '专属cache回收', run: controller.run, reconcile: controller.reconcile }]);
  await api.setJobConfig(pool, POLICY, { enabled: true });
  return { root, api, controller, transport, service, count: () => executions,
    lose: () => { loseResponse = true; }, close: async () => { await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }); } };
}
describe('专属cache真实writer→HTTP→PG闭环', () => {
  it('生产jobs冒烟精确验证固定白名单，不触发任何清理动作', async () => {
    const app = express(); app.locals.pool = pool;
    const methods = []; app.use((req, res, next) => { methods.push(req.method); next(); });
    app.use('/api/brain/janitor', janitorRouter);
    const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    try {
      const result = await exec('bash', [fileURLToPath(new URL('../../../scripts/smoke/janitor-smoke.sh', import.meta.url))], {
        env: { ...process.env, BRAIN_URL: `http://127.0.0.1:${server.address().port}` },
      });
      expect(result.stdout).toContain('[janitor-smoke] PASS');
      expect(methods).toEqual(['GET']);
      const { rows } = await pool.query('SELECT enabled FROM janitor_config WHERE job_id=$1', [POLICY]);
      expect(rows[0].enabled).toBe(false);
    } finally { await new Promise(r => server.close(r)); }
  });

  it('真实npm目录删除与df证据进原生tasks/路由收据，不写staging账', async () => {
    const f = await setup(); try {
      const result = await f.api.runJob(pool, POLICY); expect(result.status).toBe('success');
      await expect(lstat(join(f.root, '.npm-cache-preview-42'))).rejects.toMatchObject({ code: 'ENOENT' });
      const row = (await pool.query(`SELECT t.*, r.work_kind FROM tasks t JOIN work_routing_receipts r ON r.task_id=t.id
        JOIN janitor_cache_intents j ON j.task_id=t.id WHERE j.run_id=$1`, [result.run_id])).rows[0];
      expect(row).toMatchObject({ status: 'completed', task_type: 'janitor', executor_kind: 'preview-janitor', work_kind: 'operations' });
      expect(row.result.receipt).toMatchObject({ status: 'success', actor: 'preview-agent:mmv', evidence: { absent: true } });
      expect(row.result.receipt.after.available_bytes).toBeGreaterThan(0);
      expect(row.result.handoff.next_steps).toEqual([]);
      expect(f.count()).toBe(1);
    } finally { await f.close(); }
  });
  it('两个controller事务并发只认领一个task/intent，任务payload修改不能换删除对象', async () => {
    const f = await setup(); try {
      const plan = await f.transport.plan(); const run = randomUUID();
      await pool.query("INSERT INTO janitor_runs(id,job_id,job_name,status) VALUES($1,$2,'fixture','running')", [run, POLICY]);
      const [a,b] = await Promise.all([f.controller.claim(plan.resources[0], run), f.controller.claim(plan.resources[0], run)]);
      expect(a.request.intent_id).toBe(b.request.intent_id); expect(a.task_id).toBe(b.task_id);
      await expect(pool.query("UPDATE janitor_cache_intents SET request='{}' WHERE task_id=$1", [a.task_id])).rejects.toThrow();
      await pool.query("UPDATE tasks SET payload='{}' WHERE id=$1", [a.task_id]);
      const nextRun = randomUUID();
      await pool.query("INSERT INTO janitor_runs(id,job_id,job_name,status) VALUES($1,$2,'fixture','running')", [nextRun, POLICY]);
      expect((await f.controller.claim(plan.resources[0], nextRun)).request).toEqual(a.request);
      await pool.query("DELETE FROM janitor_cache_intents WHERE task_id=$1", [a.task_id]);
      await pool.query('DELETE FROM janitor_runs WHERE id=ANY($1::uuid[])', [[run, nextRun]]);
    } finally { await f.close(); }
  });
  it('请求响应丢失保留running和原blocked任务，只读同intent回执对账后补终态', async () => {
    const f = await setup(); f.lose(); try {
      await expect(f.api.runJob(pool, POLICY)).rejects.toMatchObject({ code: 'JANITOR_UNCONFIRMED' });
      const row = (await pool.query("SELECT * FROM janitor_runs WHERE job_id=$1 AND status='running'", [POLICY])).rows[0];
      expect(row).toBeTruthy();
      const task = (await pool.query('SELECT t.* FROM tasks t JOIN janitor_cache_intents j ON j.task_id=t.id WHERE j.run_id=$1', [row.id])).rows[0];
      expect(task.status).toBe('blocked');
      await expect(f.api.runJob(pool, POLICY)).rejects.toMatchObject({ code: 'JANITOR_UNCONFIRMED' });
      await f.api.reconcileJob(pool, POLICY);
      expect((await pool.query('SELECT status FROM tasks WHERE id=$1', [task.id])).rows[0].status).toBe('completed');
      expect((await pool.query('SELECT status FROM janitor_runs WHERE id=$1', [row.id])).rows[0].status).toBe('success');
      expect(f.count()).toBe(1);
    } finally { await f.close(); }
  });
});
it('收到另一个task/intent的成功回执仍保留blocked，恢复正确回执才结算', async () => {
  const f = await setup(); try {
    const broken = createPreviewCacheController({ pool, client: { ...f.transport,
      receipt: async (id, signal) => ({ ...await f.transport.receipt(id, signal), task_id: randomUUID() }) } });
    const api = createJanitor([{ JOB_ID: POLICY, JOB_NAME: '专属cache回收', run: broken.run, reconcile: broken.reconcile }]);
    await expect(api.runJob(pool, POLICY)).rejects.toMatchObject({ code: 'JANITOR_UNCONFIRMED' });
    const row = (await pool.query("SELECT j.* FROM janitor_cache_intents j JOIN tasks t ON t.id=j.task_id WHERE t.status='blocked' AND j.settled_at IS NULL ORDER BY j.created_at DESC LIMIT 1")).rows[0];
    expect(row.receipt).toBeNull();
    await expect(api.reconcileJob(pool, POLICY)).rejects.toMatchObject({ code: 'JANITOR_UNCONFIRMED' });
    await f.api.reconcileJob(pool, POLICY);
    expect((await pool.query('SELECT status FROM tasks WHERE id=$1', [row.task_id])).rows[0].status).toBe('completed');
    expect(f.count()).toBe(1);
  } finally { await f.close(); }
});
it('迁移默认disabled；原有类型/执行器限制保留，非法值不能入tasks', async () => {
  // 该suite前面显式启用过；新隔离表上的迁移语义由SQL入库值验证。
  const sql = await readFile(new URL('../../../migrations/502_preview_owned_cache_janitor.sql', import.meta.url), 'utf8');
  expect(sql).toContain("VALUES('preview-owned-npm-cache-expiry-v1',false)");
  await expect(pool.query("INSERT INTO tasks(id,title,task_type,status) VALUES($1,'非法类型','not_a_real_type','blocked')", [randomUUID()])).rejects.toThrow();
  await expect(pool.query("INSERT INTO tasks(id,title,task_type,executor_kind,status) VALUES($1,'非法执行器','janitor','not_a_real_executor','blocked')", [randomUUID()])).rejects.toThrow();
});
