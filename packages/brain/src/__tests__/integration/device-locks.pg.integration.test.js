import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import {
  acquireDeviceLock,
  releaseDeviceLocksHeldBy,
  sweepStaleDeviceLocks,
} from '../../device-lock-helpers.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PHONE = 'ANGYVB4311010223'; // migration 448 种子行
const PHONE_2 = 'e6c7ef34'; // migration 448 种子行（xian-m1 第二台）
let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^device_locks_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function seedTask(status) {
  const taskId = randomUUID();
  // title 带 taskId 唯一化：tasks 表 idx_tasks_dedup_active 对活跃任务按
  // (title, goal_id, project_id) 去重，同名 title 会撞唯一索引
  await testPool.query(
    'INSERT INTO tasks (id,title,status) VALUES ($1,$2,$3)',
    [taskId, `device lock test ${taskId}`, status],
  );
  return taskId;
}

beforeAll(async () => {
  databaseName = `device_locks_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 8 });
}, 60_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

beforeEach(async () => {
  await testPool.query(
    'UPDATE device_locks SET locked_by=NULL, locked_at=NULL, expires_at=NULL',
  );
});

describe.sequential('device-lock-helpers on PostgreSQL', () => {
  it('并发 acquire 同一设备恰一个赢', async () => {
    const taskA = await seedTask('queued');
    const taskB = await seedTask('queued');
    const [a, b] = await Promise.all([
      acquireDeviceLock(taskA, PHONE, 30, testPool),
      acquireDeviceLock(taskB, PHONE, 30, testPool),
    ]);
    expect([a.result, b.result].sort()).toEqual(['acquired', 'locked']);
    const winner = a.result === 'acquired' ? taskA : taskB;
    const { rows } = await testPool.query(
      'SELECT locked_by, expires_at FROM device_locks WHERE device_name=$1',
      [PHONE],
    );
    expect(rows[0].locked_by).toBe(String(winner));
    expect(rows[0].expires_at).not.toBeNull();
  }, 15_000);

  it('同持有者 reacquire 续期成功', async () => {
    const taskId = await seedTask('in_progress');
    const first = await acquireDeviceLock(taskId, PHONE, 30, testPool);
    expect(first.result).toBe('acquired');
    const second = await acquireDeviceLock(taskId, PHONE, 60, testPool);
    expect(second.result).toBe('acquired');
    expect(second.lock.locked_by).toBe(String(taskId));
  }, 15_000);

  it('过期 + 持有任务仍 in_progress → 不可抢', async () => {
    const holder = await seedTask('in_progress');
    const rival = await seedTask('queued');
    expect((await acquireDeviceLock(holder, PHONE, 30, testPool)).result).toBe('acquired');
    await testPool.query(
      "UPDATE device_locks SET expires_at = NOW() - INTERVAL '1 minute' WHERE device_name=$1",
      [PHONE],
    );
    const attempt = await acquireDeviceLock(rival, PHONE, 30, testPool);
    expect(attempt.result).toBe('locked');
    expect(attempt.holder.locked_by).toBe(String(holder));
  }, 15_000);

  it('过期 + 持有任务已 failed → 可抢', async () => {
    const holder = await seedTask('failed');
    const rival = await seedTask('queued');
    await testPool.query(
      `UPDATE device_locks
          SET locked_by=$1, locked_at=NOW() - INTERVAL '2 hours',
              expires_at=NOW() - INTERVAL '1 minute'
        WHERE device_name=$2`,
      [String(holder), PHONE],
    );
    const attempt = await acquireDeviceLock(rival, PHONE, 30, testPool);
    expect(attempt.result).toBe('acquired');
    expect(attempt.lock.locked_by).toBe(String(rival));
  }, 15_000);

  it('未注册 serial → unknown_device', async () => {
    const taskId = await seedTask('queued');
    const attempt = await acquireDeviceLock(taskId, 'NO_SUCH_SERIAL_123', 30, testPool);
    expect(attempt.result).toBe('unknown_device');
  }, 15_000);

  it('永久锁（expires_at IS NULL 且 locked_by 非空）持有任务 in_progress 时不可抢', async () => {
    const holder = await seedTask('in_progress');
    const rival = await seedTask('queued');
    await testPool.query(
      'UPDATE device_locks SET locked_by=$1, locked_at=NOW(), expires_at=NULL WHERE device_name=$2',
      [String(holder), PHONE],
    );
    const attempt = await acquireDeviceLock(rival, PHONE, 30, testPool);
    expect(attempt.result).toBe('locked');
    expect(attempt.holder.locked_by).toBe(String(holder));
  }, 15_000);

  it('releaseDeviceLocksHeldBy 只放本任务的锁', async () => {
    const taskA = await seedTask('in_progress');
    const taskB = await seedTask('in_progress');
    expect((await acquireDeviceLock(taskA, PHONE, 30, testPool)).result).toBe('acquired');
    expect((await acquireDeviceLock(taskB, PHONE_2, 30, testPool)).result).toBe('acquired');
    const released = await releaseDeviceLocksHeldBy(taskA, testPool);
    expect(released).toBe(1);
    const { rows } = await testPool.query(
      'SELECT device_name, locked_by FROM device_locks WHERE device_name = ANY($1)',
      [[PHONE, PHONE_2]],
    );
    const byName = Object.fromEntries(rows.map((r) => [r.device_name, r.locked_by]));
    expect(byName[PHONE]).toBeNull();
    expect(byName[PHONE_2]).toBe(String(taskB));
  }, 15_000);

  it('sweepStaleDeviceLocks：持有任务 completed 的锁被放、in_progress 的保留', async () => {
    const doneTask = await seedTask('completed');
    const liveTask = await seedTask('in_progress');
    await testPool.query(
      'UPDATE device_locks SET locked_by=$1, locked_at=NOW(), expires_at=NOW() WHERE device_name=$2',
      [String(doneTask), PHONE],
    );
    expect((await acquireDeviceLock(liveTask, PHONE_2, 30, testPool)).result).toBe('acquired');
    const swept = await sweepStaleDeviceLocks(testPool);
    expect(swept).toBe(1);
    const { rows } = await testPool.query(
      'SELECT device_name, locked_by FROM device_locks WHERE device_name = ANY($1)',
      [[PHONE, PHONE_2]],
    );
    const byName = Object.fromEntries(rows.map((r) => [r.device_name, r.locked_by]));
    expect(byName[PHONE]).toBeNull();
    expect(byName[PHONE_2]).toBe(String(liveTask));
  }, 15_000);

  it('sweepStaleDeviceLocks：持有 task id 不存在于 tasks 表 → 释放', async () => {
    const ghostTaskId = randomUUID();
    await testPool.query(
      'UPDATE device_locks SET locked_by=$1, locked_at=NOW(), expires_at=NULL WHERE device_name=$2',
      [String(ghostTaskId), PHONE],
    );
    const swept = await sweepStaleDeviceLocks(testPool);
    expect(swept).toBe(1);
    const { rows } = await testPool.query(
      'SELECT locked_by FROM device_locks WHERE device_name=$1',
      [PHONE],
    );
    expect(rows[0].locked_by).toBeNull();
  }, 15_000);
});
