/**
 * [BEHAVIOR] Session Controller ownership + createKernelRun fail-closed + migration 413 列
 * + 启动链收敛（sprint 08131104 Harness 入口统一，issue 962d399c 无主 Kernel Run 修复）。
 *
 * 真 Postgres 集成——真 migrate（含 413）+ 真 createKernelRun + 真 spawnSkillRelaySession
 * 启动链，仅替身最外层 launcher（deps.launchKernel）与 worktree ensure（deps.ensureWt）。
 *
 * 禁 mock 边（合同「禁 mock 边清单」）：
 *  - 代码 ↔ initiative_runs.controller_session_id / controller_lease_expires_at：真 pool 连真 PG，
 *    禁 mock pool.query 顶替 INSERT/SELECT。
 *  - createKernelRun ↔ initiative_runs（fail-closed 分支）：真 createKernelRun 真 PG 事务，禁 stub。
 *  - harness-skill-relay Dispatcher→Controller→Kernel 启动链：真 spawnSkillRelaySession +
 *    真 createKernelRun，只替身最外层 launcher / worktree ensure（与「先取 ownership 再拉 Kernel」
 *    这条被改的边无关的外层依赖）。
 * 本文件不含对 kernel-run-store / derive / ground-truth 被改边的 vi.mock（INV-1 机械 grep 核查）。
 *
 * 登记进 vitest.config.js 的 POSTGRES_INTEGRATION_TESTS，由 brain-integration job 起真 PG 跑。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { createKernelRun } from '../../orchestrator/kernel-run-store.js';
import { spawnSkillRelaySession } from '../../harness-skill-relay.js';
import {
  createRoutedKernelRun,
  seedRoutedKernelTask,
} from './helpers/routed-kernel-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^kernel_ctlown_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function createIsolatedDatabase() {
  databaseName = `kernel_ctlown_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1, statement_timeout: 10_000 });
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  // 真跑仓库真实迁移（migrate.js 按文件名序执行至最新），controller ownership 列由 413 落库。
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
    await adminPool.query(
      'UPDATE pg_database SET datallowconn=false WHERE datname=$1',
      [databaseName],
    ).catch(() => {});
    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    ).catch(() => {});
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`,
    ).catch(() => {});
  }
  if (adminPool) await adminPool.end().catch(() => {});
}

async function seedTask() {
  const initiativeId = randomUUID();
  const taskId = randomUUID();
  const payload = {
    harness_runtime: 'kernel-v1',
    orchestrator: 'skill-relay',
    sprint_dir: `sprints/08131104-ctlown-${taskId.slice(0, 8)}`,
    worktree_path: '/workspace',
    base_repo: 'perfectuser21/cecelia',
    initiative_id: initiativeId,
  };
  return seedRoutedKernelTask(testPool, {
    titlePrefix: 'kernel-ctlown',
    initiativeId,
    taskId,
    changeKind: 'bugfix',
    payload,
  });
}

async function runCount(taskId) {
  const { rows } = await testPool.query(
    'SELECT count(*)::int AS n FROM initiative_runs WHERE current_task_id = $1',
    [taskId],
  );
  return rows[0].n;
}

beforeAll(createIsolatedDatabase, 60_000);
afterAll(dropIsolatedDatabase, 30_000);

describe('Session Controller ownership + fail-closed + migration 413（真 PG）', () => {
  it('migration 413 加 controller ownership 列（initiative_runs information_schema）', async () => {
    const { rows } = await testPool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_name = 'initiative_runs'
          AND column_name IN ('controller_session_id', 'controller_lease_expires_at')
        ORDER BY column_name`,
    );
    const cols = rows.map((r) => r.column_name);
    expect(cols).toContain('controller_session_id');
    expect(cols).toContain('controller_lease_expires_at');
  });

  it('createKernelRun 无 controllerSessionId fail-closed（缺失/空均拒绝，不写半态 run）', async () => {
    const { taskId, initiativeId } = await seedTask();
    const baseInput = {
      taskId,
      initiativeId,
      phase: 'planning',
      journeyId: null,
      abilityId: null,
      host: 'kernel-v1',
      deadlineHours: 8,
      createdSource: 'kernel_dispatch',
    };
    expect(await runCount(taskId)).toBe(0);

    // 缺失 controllerSessionId → fail-closed 抛错
    await expect(createKernelRun(testPool, { ...baseInput }))
      .rejects.toThrow(/missing controller ownership \(fail-closed\)/);
    // 空串 controllerSessionId → fail-closed 抛错
    await expect(createKernelRun(testPool, { ...baseInput, controllerSessionId: '' }))
      .rejects.toThrow(/missing controller ownership \(fail-closed\)/);

    // 真 PG count 校验：抛错后 initiative_runs 对该 task 无新行（不写半态）
    expect(await runCount(taskId)).toBe(0);
  });

  it('createKernelRun 带 controllerSessionId → 建 run 且 ownership 先于 Kernel 可执行态落库', async () => {
    const { taskId, initiativeId } = await seedTask();
    const controllerSessionId = randomUUID();
    const created = await createRoutedKernelRun(testPool, {
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
    expect(created.created).toBe(true);
    const { rows } = await testPool.query(
      `SELECT controller_session_id, controller_lease_expires_at, started_at
         FROM initiative_runs WHERE id = $1`,
      [created.run.id],
    );
    expect(rows[0].controller_session_id).toBe(controllerSessionId);
    // lease 落库且晚于创建时刻（ownership 在同一创建事务里先于 run 可执行态写入）
    expect(rows[0].controller_lease_expires_at).not.toBeNull();
    expect(new Date(rows[0].controller_lease_expires_at).getTime())
      .toBeGreaterThan(new Date(rows[0].started_at).getTime());
  });

  it('harness_runtime=kernel-v1 直打不产生无 Controller run（真启动链，只替身最外层 launcher）', async () => {
    const { taskId, payload } = await seedTask();
    const task = { id: taskId, ability_id: null, payload };
    const res = await spawnSkillRelaySession(task, {
      pool: testPool,
      // 只替身最外层：worktree ensure + Kernel launcher（与被改的 ownership 边无关）。
      ensureWt: async () => '/workspace',
      launchKernel: async () => ({ pid: 4242 }),
      createKernelRun: (dbPool, input) => createRoutedKernelRun(dbPool, input),
      now: () => new Date(),
      env: {},
    });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('kernel-v1');

    // Controller ownership 先于 Kernel run 可执行态写入：run 存在即 controller_session_id 非空。
    const { rows } = await testPool.query(
      `SELECT id, controller_session_id, phase
         FROM initiative_runs WHERE current_task_id = $1`,
      [taskId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].controller_session_id).not.toBeNull();
    expect(String(rows[0].controller_session_id).trim()).not.toBe('');

    // 不存在 controller_session_id IS NULL 的活跃 Kernel run（无主 run count=0）。
    const { rows: ownerless } = await testPool.query(
      `SELECT count(*)::int AS n
         FROM initiative_runs
        WHERE current_task_id = $1
          AND phase NOT IN ('done', 'failed')
          AND controller_session_id IS NULL`,
      [taskId],
    );
    expect(ownerless[0].n).toBe(0);
  });
});
