/**
 * [BEHAVIOR] 手机忙排队等待（任务 5ad81457）真 Postgres 集成：回队 UPDATE 与同机串行闸 SELECT 落库真验。
 *
 * 禁 mock 边：lib/qiumi-device-busy.js 的回队 UPDATE（jsonb 删键 + status_history 追加 + notion_props 删指纹）、
 * routing/qiumi-serial-gate.js 的 jsonb 路径查询——都是 SQL 语义，mock 断言字符串照不出来。
 * 登记在 packages/brain/vitest.config.js 的 POSTGRES_INTEGRATION_TESTS。
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import pool from '../../db.js';
import { planDeviceBusy, requeueForDeviceBusy } from '../../lib/qiumi-device-busy.js';
import { findSameSerialBusy } from '../../routing/qiumi-serial-gate.js';

const created = [];
const SERIAL = `TEST-${randomUUID().slice(0, 8)}`;

async function seed({ status = 'in_progress', serial = SERIAL, runId = 'qiumi-test-1' } = {}) {
  const id = randomUUID();
  const payload = { run_id: runId, qiumi_route: { source: 'jev', device_hint: { is_device: true, serial } } };
  await pool.query(
    `INSERT INTO tasks (id, title, task_type, status, payload, notion_props)
     VALUES ($1, $2, 'qiumi_task', $3, $4::jsonb, '{"qiumi_pushed_status":"in_progress"}'::jsonb)`,
    [id, `device busy pg test ${id}`, status, JSON.stringify(payload)],
  );
  created.push(id);
  return id;
}

afterAll(async () => {
  if (created.length) {
    await pool.query('DELETE FROM task_events WHERE task_id = ANY($1::uuid[])', [created]);
    await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [created]);
  }
  await pool.end().catch(() => {});
});

describe('requeueForDeviceBusy — 真 PG', () => {
  it('in_progress → queued：清 run_id、保留 qiumi_route、写 next_run_at/attempts、追加 status_history、删回写指纹', async () => {
    const id = await seed();
    const now = Date.now();
    const plan = planDeviceBusy({ payload: {}, marker: { owner: 'harvest-cron', serial: SERIAL }, timeoutSec: 1800, now });
    expect(await requeueForDeviceBusy(pool, id, plan, 'qiumi-test-1')).toBe(true);

    const { rows: [t] } = await pool.query('SELECT status, payload, status_history, notion_props, claimed_by FROM tasks WHERE id = $1', [id]);
    expect(t.status).toBe('queued');
    expect(t.claimed_by).toBeNull();
    expect(t.payload.run_id).toBeUndefined();
    expect(t.payload.qiumi_route.device_hint.serial).toBe(SERIAL);
    expect(Date.parse(t.payload.next_run_at) - now).toBe(5 * 60_000);
    expect(t.payload.device_busy_attempts).toBe(1);
    expect(t.payload.device_busy).toMatchObject({ owner: 'harvest-cron', attempts: 1, last_run_id: 'qiumi-test-1' });
    expect(t.status_history.at(-1)).toMatchObject({ from: 'in_progress', to: 'queued', source: 'device_busy', attempt: 1 });
    expect(t.status_history.at(-1).changed_at).toBeTruthy();
    expect(t.notion_props).not.toHaveProperty('qiumi_pushed_status');
  });

  it('CAS：任务已不在 in_progress（别的通道结过账）→ 不动', async () => {
    const id = await seed({ status: 'failed' });
    const plan = planDeviceBusy({ payload: {}, marker: { owner: 'x', serial: SERIAL }, timeoutSec: 1800, now: Date.now() });
    expect(await requeueForDeviceBusy(pool, id, plan, 'r')).toBe(false);
    const { rows: [t] } = await pool.query('SELECT status FROM tasks WHERE id = $1', [id]);
    expect(t.status).toBe('failed');
  });
});

describe('findSameSerialBusy — 真 PG', () => {
  it('同 serial 另有 in_progress 秋米任务 → 命中；换 serial / 只有自己 → null', async () => {
    const serial = `TEST-${randomUUID().slice(0, 8)}`;
    const running = await seed({ serial });
    const me = await seed({ status: 'queued', serial });
    const busy = await findSameSerialBusy(pool, me, serial);
    expect(busy?.id).toBe(running);
    expect(await findSameSerialBusy(pool, me, `${serial}-other`)).toBeNull();
    expect(await findSameSerialBusy(pool, running, serial), '把自己当成占用者').toBeNull();
    const { rows } = await pool.query(
      "SELECT payload FROM task_events WHERE task_id = $1 AND event_type = 'qiumi_dispatch_device_busy'", [me],
    );
    expect(rows[0]?.payload).toMatchObject({ serial, busy_task_id: running });
  });
});
