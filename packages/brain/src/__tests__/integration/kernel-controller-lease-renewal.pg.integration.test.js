/**
 * [BEHAVIOR] Controller lease heartbeat 续租 + CAS fail-closed（真 PG，RED-1/2/3/5）
 * sprint 08132021-controller-lease-renewal-r2 —— run 60fa6c43 实证根因：
 *   heartbeat.js 的 UPDATE 从不延长 controller_lease_expires_at，心跳跨过 30m lease
 *   仍被 reconcileOwnerlessKernelRuns 当无主取消（Generator 034b5ca7 被杀）。
 *
 * 本文件是「禁 mock 边清单」的执法测试：代码 ↔ initiative_runs（controller lease 读写）
 * 走真 pg.Pool 连真 PostgreSQL；createKernelRun / writeHeartbeat / reconcileOwnerlessKernelRuns
 * 全真代码路径，禁 vi.mock('pg') / stub 被改的 DB 写边。30m 边界用注入 now 确定性跨越
 * （lease 默认 1800s，注入 now = 建 run + 31min 即已越界），不靠真实等待。
 *
 * TDD 顺序：
 *   Commit A（此文件）: 现网 writeHeartbeat 无 controllerSessionId 入参、不写 lease、
 *                       不返回 rowCount → 全部断言 FAIL（红证据）。
 *   Commit B（修复）:   writeHeartbeat 续租 CAS + GREATEST，测试转绿。
 *
 * 永久回归位（sprint frozen 版在 sprints/08132021-controller-lease-renewal-r2/tests/），
 * 登记进 packages/brain/vitest.config.js 的 POSTGRES_INTEGRATION_TESTS，
 * 由 CI brain-integration job 起真 PG 常驻跑。
 *
 * 禁止：vi.mock('pg') / jest.mock('pg') / stub writeHeartbeat / stub reconciler。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import {
  createKernelRun,
  finalizeKernelRun,
  CONTROLLER_LEASE_DEFAULT_SECONDS,
} from '../../orchestrator/kernel-run-store.js';
import { writeHeartbeat } from '../../orchestrator/heartbeat.js';
import { reconcileOwnerlessKernelRuns } from '../../orchestrator/kernel-controller-lifecycle.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LEASE = CONTROLLER_LEASE_DEFAULT_SECONDS; // 1800（唯一 SSOT，禁止本文件另写死秒数）
const MIN = 60_000;

let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^kernel_leaserenew_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function createIsolatedDatabase() {
  databaseName = `kernel_leaserenew_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1, statement_timeout: 10_000 });
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
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 10 });
}

async function dropIsolatedDatabase() {
  if (testPool) await testPool.end().catch(() => {});
  if (adminPool && databaseName) {
    await adminPool.query('UPDATE pg_database SET datallowconn=false WHERE datname=$1', [databaseName]).catch(() => {});
    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    ).catch(() => {});
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`).catch(() => {});
  }
  if (adminPool) await adminPool.end().catch(() => {});
}

async function seedOwnedRun({ controllerSessionId }) {
  const initiativeId = randomUUID();
  const taskId = randomUUID();
  await testPool.query(
    `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, payload)
     VALUES ($1, $2, 'in_progress', 'P2', 'harness_initiative', 'api', $3::jsonb)`,
    [taskId, `kernel-leaserenew-${taskId}`, JSON.stringify({ initiative_id: initiativeId })],
  );
  const created = await createKernelRun(testPool, {
    taskId,
    initiativeId,
    phase: 'planning',
    journeyId: null,
    abilityId: null,
    host: 'kernel-v1',
    deadlineHours: 8,
    createdSource: 'kernel_dispatch',
    controllerSessionId,
  });
  return { runId: created.run.id, taskId, initiativeId };
}

async function leaseOf(runId) {
  const { rows } = await testPool.query(
    'SELECT controller_lease_expires_at, phase FROM initiative_runs WHERE id = $1',
    [runId],
  );
  return rows[0];
}

beforeAll(createIsolatedDatabase, 60_000);
afterAll(dropIsolatedDatabase, 30_000);

describe('Controller lease heartbeat 续租 CAS（真 PG）', () => {
  it('RED-1: 正确 session 心跳跨过 30m 边界 → lease 随心跳前移、run 保持 active、reconcile 回收数=0', async () => {
    const session = randomUUID();
    const { runId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);

    // 建 run 31 分钟后（已越过 30m/1800s 原始 lease）心跳一次
    const now1 = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 + 31 * MIN);
    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: now1, controllerSessionId: session,
    });
    expect(res.rowCount).toBe(1); // CAS 命中：正确 session + 活跃 phase

    const after = await leaseOf(runId);
    // GREATEST(existing, now+lease) → lease 前移到 now1 + LEASE，已晚于 now1（未过期）
    expect(Date.parse(after.controller_lease_expires_at)).toBe(now1.getTime() + LEASE * 1000);
    expect(Date.parse(after.controller_lease_expires_at)).toBeGreaterThan(now1.getTime());
    expect(after.phase).not.toBe('done');
    expect(after.phase).not.toBe('failed');

    // 心跳后紧接 reconcile（同一 now 语义）→ 该 run 不被判无主
    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: new Date(now1.getTime() + 1000) });
    expect(recovered.map((r) => r.runId)).not.toContain(runId);
  });

  it('RED-1b: lease 只增不减（GREATEST）——过去时刻心跳不得缩短已有租约', async () => {
    const session = randomUUID();
    const { runId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);
    const past = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 - 5 * MIN);
    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: past, controllerSessionId: session,
    });
    expect(res.rowCount).toBe(1);
    const after = await leaseOf(runId);
    // now(past)+LEASE < 原 lease → GREATEST 保留原 lease，不回缩
    expect(Date.parse(after.controller_lease_expires_at)).toBe(Date.parse(before.controller_lease_expires_at));
  });

  it('RED-2 + RED-5(mismatch): 错误 session 心跳 → CAS rowCount=0、lease 不动、无主 run 仍被 reconcile fail-closed 回收', async () => {
    const session = randomUUID();
    const { runId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);
    const now1 = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 + 31 * MIN);

    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: now1, controllerSessionId: 'forged-wrong-session',
    });
    expect(res.rowCount).toBe(0); // 伪造 session 不得续租

    const after = await leaseOf(runId);
    expect(Date.parse(after.controller_lease_expires_at)).toBe(Date.parse(before.controller_lease_expires_at));

    // lease 已过期（now1 越界）且续租失败 → reconcile 仍把该无主 run fail-closed 回收
    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: new Date(now1.getTime() + 1000) });
    expect(recovered.map((r) => r.runId)).toContain(runId);
    const reclaimed = await leaseOf(runId);
    expect(reclaimed.phase).toBe('failed');
  });

  it('RED-3: phase=failed 的 run 心跳 → rowCount=0，lease 不复活', async () => {
    const session = randomUUID();
    const { runId, taskId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);
    await finalizeKernelRun(testPool, {
      runId, expectedTaskId: taskId, outcome: 'failed', reason: 'test_terminal',
    });

    const now1 = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 + 31 * MIN);
    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: now1, controllerSessionId: session,
    });
    expect(res.rowCount).toBe(0); // 终态 run 不得被心跳复活

    const after = await leaseOf(runId);
    expect(after.phase).toBe('failed');
    expect(Date.parse(after.controller_lease_expires_at)).toBe(Date.parse(before.controller_lease_expires_at));
  });

  it('RED-3b: leaseSeconds 复用单一 SSOT——省略 leaseSeconds 时续租默认用 CONTROLLER_LEASE_DEFAULT_SECONDS', async () => {
    const session = randomUUID();
    const { runId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);
    const now1 = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 + 31 * MIN);
    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: now1, controllerSessionId: session,
    });
    expect(res.rowCount).toBe(1);
    const after = await leaseOf(runId);
    expect(Date.parse(after.controller_lease_expires_at)).toBe(now1.getTime() + CONTROLLER_LEASE_DEFAULT_SECONDS * 1000);
  });
});
