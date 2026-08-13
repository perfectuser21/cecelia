/**
 * [BEHAVIOR] 刀二 — legacy one-session relay 创建 initiative_runs 必带可续租 Controller ownership，
 * 且带有效 lease 的活 relay run 活过一个 reconcileOwnerlessKernelRuns 巡检周期（不被 no_controller_ownership 误杀）。
 *
 * 真 Postgres 集成（禁 mock 被改的边）：
 *  - 代码 ↔ initiative_runs.controller_session_id / controller_lease_expires_at：真 testPool 连真 PG，
 *    禁 mock pool.query 顶替 INSERT/SELECT（本单新增写这两列，是被改的 DB 写路径）。
 *  - harness-skill-relay 建 run 分支 ↔ 创建事务 ↔ initiative_runs：真 spawnSkillRelaySession 真 pool，
 *    只替身与"落库带 ownership"这条边无关的最外层依赖（docker ps / spawn / worktree / skill / token / 账号）。
 *  - reconcileOwnerlessKernelRuns ↔ initiative_runs（状态机终态判定 + DB 读写）：真 PG，禁 mock。
 *
 * 本文件不含对 harness-skill-relay / kernel-run-store / kernel-controller-lifecycle 被改边的 vi.mock。
 *
 * Red 依据（未修复前）：session 分支直写 INSERT 未填 controller_session_id / controller_lease_expires_at，
 * 两列为 NULL → 用例①断言非空 FAIL；随后 reconcile 会把它当无主 run 终态化 → 用例②断言"活过巡检"FAIL。
 *
 * Green 后：generator 需把 4 处 legacy INSERT（session / grok fallback / xian / headed）统一收敛为带
 * ownership 的创建（复用 createKernelRun 或等价单一创建函数），并登记本文件进 vitest.config.js
 * POSTGRES_INTEGRATION_TESTS（放 src/__tests__/integration/ 下由 brain-integration job 起真 PG 跑）。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../../packages/brain/src/db-config.js';
import { spawnSkillRelaySession } from '../../../packages/brain/src/harness-skill-relay.js';
import { reconcileOwnerlessKernelRuns } from '../../../packages/brain/src/orchestrator/kernel-controller-lifecycle.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../packages/brain/', import.meta.url));

let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^relay_own_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function createIsolatedDatabase() {
  databaseName = `relay_own_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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

async function seedRelayTask() {
  const initiativeId = randomUUID();
  const taskId = randomUUID();
  const payload = {
    orchestrator: 'skill-relay',
    sprint_dir: `sprints/08131620-relay-own-${taskId.slice(0, 8)}`,
    worktree_path: '/workspace',
    base_repo: 'perfectuser21/cecelia',
    initiative_id: initiativeId,
  };
  await testPool.query(
    `INSERT INTO tasks (id, task_type, status, title, payload)
     VALUES ($1, 'harness_initiative', 'in_progress', 'relay ownership seed', $2::jsonb)`,
    [taskId, JSON.stringify(payload)],
  );
  return { initiativeId, taskId };
}

// 只替身与"落库带 ownership"无关的最外层依赖，pool 保持真 testPool。
function relayDeps() {
  return {
    pool: testPool,
    execFn: () => '',                                  // docker ps → 无存量容器
    spawnFn: async () => ({ ok: true }),               // 不真起 docker
    ensureWt: async () => '/workspace',                // worktree 幂等替身
    loadSkill: () => '# skill',                        // 跳过真读 skill 文件
    tokenFn: async () => 'gh-token-stub',
    resolveAccountFn: async (acctOpts) => { acctOpts.env.CECELIA_CREDENTIALS = '/tmp/creds'; },
  };
}

beforeAll(async () => { await createIsolatedDatabase(); }, 60_000);
afterAll(async () => { await dropIsolatedDatabase(); });

describe('legacy relay run Controller ownership（刀二）', () => {
  it('① session 分支建 run 落库即带非空 controller_session_id + 未来 lease', async () => {
    const { taskId } = await seedRelayTask();
    const result = await spawnSkillRelaySession(
      { id: taskId, task_type: 'harness_initiative', title: 't', payload: (await testPool.query('SELECT payload FROM tasks WHERE id=$1', [taskId])).rows[0].payload },
      relayDeps(),
    );
    expect(result.ok).toBe(true);

    const { rows } = await testPool.query(
      `SELECT controller_session_id, controller_lease_expires_at, phase, orchestrator_version
         FROM initiative_runs WHERE current_task_id=$1`,
      [taskId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].orchestrator_version).toBe('v2');
    expect(rows[0].controller_session_id).toBeTruthy();
    expect(rows[0].controller_lease_expires_at).toBeTruthy();
    expect(new Date(rows[0].controller_lease_expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('② 带有效 lease 的活 relay run 活过一个巡检周期（>5min）后仍非终态，未被 no_controller_ownership 误杀', async () => {
    const { taskId } = await seedRelayTask();
    await spawnSkillRelaySession(
      { id: taskId, task_type: 'harness_initiative', title: 't', payload: (await testPool.query('SELECT payload FROM tasks WHERE id=$1', [taskId])).rows[0].payload },
      relayDeps(),
    );
    // now 推进 6 分钟（>一个 5min 巡检周期），但默认 lease（1800s=30min）仍有效 → 不应被回收。
    const sixMinLater = new Date(Date.now() + 6 * 60 * 1000);
    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: sixMinLater });
    expect(recovered.find((r) => r.taskId === taskId)).toBeUndefined();

    const { rows } = await testPool.query(
      `SELECT phase FROM initiative_runs WHERE current_task_id=$1`,
      [taskId],
    );
    expect(['done', 'failed']).not.toContain(rows[0].phase);
  });

  it('③ 对照：无 ownership 的 v2 active run 经 reconcile 仍被终态化 failed（回收能力未削弱）', async () => {
    const { initiativeId, taskId } = await seedRelayTask();
    const { rows: ins } = await testPool.query(
      `INSERT INTO initiative_runs
         (initiative_id, phase, orchestrator_version, orchestrator_host, deadline_at,
          current_task_id, created_source)
       VALUES ($1, 'A_planning', 'v2', 'skill-relay-session', NOW() + INTERVAL '6 hours',
               $2, 'legacy_relay')
       RETURNING id`,
      [initiativeId, taskId],
    );
    const ownerlessRunId = ins[0].id;
    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: new Date() });
    expect(recovered.find((r) => r.runId === ownerlessRunId)?.cause).toBe('no_controller_ownership');

    const { rows } = await testPool.query('SELECT phase FROM initiative_runs WHERE id=$1', [ownerlessRunId]);
    expect(rows[0].phase).toBe('failed');
  });
});
