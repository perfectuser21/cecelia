/**
 * [BEHAVIOR] 刀二 — legacy one-session relay 创建 initiative_runs 必带可续租 Controller ownership，
 * 且带有效 lease 的活 relay run 活过一个 reconcileOwnerlessKernelRuns 巡检周期（不被 no_controller_ownership 误杀）。
 *
 * Round 2 追加（关闭 reviewer blocker E2-1「续租承诺无生产实现」）：
 *  - 生产新增 CAS 续租写路径 renewControllerLease（绑定 controller_session_id + 非终态），
 *    由既有 relay watchdog 的活容器扫描 renewLiveRelayLeases 驱动（复用既有 5min 看门狗，不新造守护进程）。
 *  - 边界证据：健康 relay 经续租活过 >30min 默认 lease 边界不被 reconcile 回收（用例⑦）；
 *    owner 不匹配拒绝续租（用例⑤）；终态 run 拒绝续租（用例⑥）；
 *    死容器不续租 → lease 真过期 → reconcile 以 controller_lease_expired 回收（用例⑧，真实过期 owner 回收）。
 *
 * 真 Postgres 集成（禁 mock 被改的边）：
 *  - 代码 ↔ initiative_runs.controller_session_id / controller_lease_expires_at：真 testPool 连真 PG，
 *    禁 mock pool.query 顶替 INSERT/SELECT/UPDATE（本单新增写这两列 + 新增 CAS 续租 UPDATE，是被改的 DB 写路径）。
 *  - harness-skill-relay 建 run 分支 ↔ 创建事务 ↔ initiative_runs：真 spawnSkillRelaySession 真 pool，
 *    只替身与"落库带 ownership"这条边无关的最外层依赖（docker ps / spawn / worktree / skill / token / 账号）。
 *  - reconcileOwnerlessKernelRuns / renewControllerLease / renewLiveRelayLeases ↔ initiative_runs
 *    （状态机终态判定 + lease 续租 CAS + DB 读写）：真 PG，禁 mock。仅 docker ps 活性探针 execFn 为最外层替身。
 *
 * 本文件不含对 harness-skill-relay / kernel-run-store / kernel-controller-lifecycle /
 * harness-relay-watchdog 被改边的 vi.mock。
 *
 * Red 依据（未修复前）：
 *  - 用例①②③：session 分支直写 INSERT 未填 ownership 两列 → NULL → ① FAIL；reconcile 误杀 → ② FAIL。
 *  - 用例④⑤⑥：renewControllerLease 生产未实现 → import 为 undefined / 调用抛错 → FAIL。
 *  - 用例⑦：renewLiveRelayLeases 生产未实现 + 无续租 → t+40min reconcile 回收健康 run → 断言"不回收"FAIL。
 *  - 用例⑧：ownership 两列 NULL（刀二未修）→ cause=no_controller_ownership 而非 controller_lease_expired → FAIL。
 *
 * Green 后：generator 需 (a) 把 4 处 legacy INSERT（session / grok fallback / xian / headed）统一收敛为带
 * ownership 的创建（复用 createKernelRun 或等价单一创建函数）；(b) 新增 renewControllerLease CAS 续租写路径；
 * (c) 在既有 relay watchdog 增 renewLiveRelayLeases 活容器续租扫描并接入 runHarnessWatchdogOnce；
 * 并登记本文件进 vitest.config.js POSTGRES_INTEGRATION_TESTS（放 src/__tests__/integration/ 下由 brain-integration job 起真 PG 跑）。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../../packages/brain/src/db-config.js';
import { spawnSkillRelaySession } from '../../../packages/brain/src/harness-skill-relay.js';
import { renewControllerLease, CONTROLLER_LEASE_DEFAULT_SECONDS } from '../../../packages/brain/src/orchestrator/kernel-run-store.js';
import { renewLiveRelayLeases } from '../../../packages/brain/src/harness-relay-watchdog.js';
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

// 从隔离库读回真实 task 行给 spawnSkillRelaySession（禁伪造 payload，走真 DB）。
async function loadTaskRow(taskId) {
  const { rows } = await testPool.query('SELECT payload FROM tasks WHERE id=$1', [taskId]);
  return { id: taskId, task_type: 'harness_initiative', title: 't', payload: rows[0].payload };
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
    const result = await spawnSkillRelaySession(await loadTaskRow(taskId), relayDeps());
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
    await spawnSkillRelaySession(await loadTaskRow(taskId), relayDeps());
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

describe('Controller lease 生产续租路径（刀二 · Round 2 关闭 E2-1）', () => {
  it('④ renewControllerLease：owner 匹配且非终态 → 续租成功，lease 推到 now+leaseSeconds（>默认 lease 早已过期时仍复活续租窗口）', async () => {
    const { taskId } = await seedRelayTask();
    await spawnSkillRelaySession(await loadTaskRow(taskId), relayDeps());
    const { rows: r0 } = await testPool.query(
      `SELECT id, controller_session_id FROM initiative_runs WHERE current_task_id=$1`, [taskId],
    );
    const run = r0[0];
    // now = +1h：若无续租写路径，默认 30min lease 早已过期；续租须把 lease 推到 now+1800s。
    const now = new Date(Date.now() + 60 * 60 * 1000);
    const res = await renewControllerLease(testPool, {
      runId: run.id, controllerSessionId: run.controller_session_id, leaseSeconds: 1800, now,
    });
    expect(res.renewed).toBe(true);
    const { rows: r1 } = await testPool.query(
      `SELECT controller_lease_expires_at FROM initiative_runs WHERE id=$1`, [run.id],
    );
    expect(new Date(r1[0].controller_lease_expires_at).getTime()).toBeGreaterThan(now.getTime());
  });

  it('⑤ renewControllerLease：owner 不匹配（错 controller_session_id）→ renewed=false，lease 一字不动（非 owner 不得续租）', async () => {
    const { taskId } = await seedRelayTask();
    await spawnSkillRelaySession(await loadTaskRow(taskId), relayDeps());
    const { rows: r0 } = await testPool.query(
      `SELECT id, controller_lease_expires_at FROM initiative_runs WHERE current_task_id=$1`, [taskId],
    );
    const run = r0[0];
    const before = new Date(run.controller_lease_expires_at).getTime();
    const res = await renewControllerLease(testPool, {
      runId: run.id, controllerSessionId: randomUUID(), leaseSeconds: 1800, now: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(res.renewed).toBe(false);
    const { rows: r1 } = await testPool.query(
      `SELECT controller_lease_expires_at FROM initiative_runs WHERE id=$1`, [run.id],
    );
    expect(new Date(r1[0].controller_lease_expires_at).getTime()).toBe(before);
  });

  it('⑥ renewControllerLease：run 已终态(failed)→ renewed=false（终态不复活 lease，防两代运行时争夺终态权）', async () => {
    const { taskId } = await seedRelayTask();
    await spawnSkillRelaySession(await loadTaskRow(taskId), relayDeps());
    const { rows: r0 } = await testPool.query(
      `SELECT id, controller_session_id FROM initiative_runs WHERE current_task_id=$1`, [taskId],
    );
    const run = r0[0];
    await testPool.query(`UPDATE initiative_runs SET phase='failed' WHERE id=$1`, [run.id]);
    const res = await renewControllerLease(testPool, {
      runId: run.id, controllerSessionId: run.controller_session_id, leaseSeconds: 1800, now: new Date(),
    });
    expect(res.renewed).toBe(false);
  });

  it('⑦ 活容器经 watchdog renewLiveRelayLeases 续租 → 健康 relay 活过 >30min 默认 lease 边界不被 reconcile 回收 [接缝×2]', async () => {
    const { taskId } = await seedRelayTask();
    await spawnSkillRelaySession(await loadTaskRow(taskId), relayDeps());
    const { rows: r0 } = await testPool.query(
      `SELECT id FROM initiative_runs WHERE current_task_id=$1`, [taskId],
    );
    const runId = r0[0].id;
    // t+20min：容器仍活（execFn 返回容器 id）→ renewLiveRelayLeases 续租，lease 推到 t+50min。
    const t20 = new Date(Date.now() + 20 * 60 * 1000);
    const scan = await renewLiveRelayLeases(testPool, {
      execFn: () => 'abc123containerid', now: t20, leaseSeconds: CONTROLLER_LEASE_DEFAULT_SECONDS,
    });
    expect(scan.renewed.some((x) => x.runId === runId)).toBe(true);
    // t+40min（>30min 原始 lease 边界）reconcile：续租后 lease=t+50min 仍在未来 → 不回收。
    const t40 = new Date(Date.now() + 40 * 60 * 1000);
    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: t40 });
    expect(recovered.find((r) => r.taskId === taskId)).toBeUndefined();
    const { rows } = await testPool.query(`SELECT phase FROM initiative_runs WHERE id=$1`, [runId]);
    expect(['done', 'failed']).not.toContain(rows[0].phase);
  });

  it('⑧ 死容器不续租（stale）→ lease 真过期后 reconcile 以 controller_lease_expired 回收（真实过期 owner 回收，回收能力未削弱）[接缝×2]', async () => {
    const { taskId } = await seedRelayTask();
    await spawnSkillRelaySession(await loadTaskRow(taskId), relayDeps());
    const { rows: r0 } = await testPool.query(
      `SELECT id, controller_session_id FROM initiative_runs WHERE current_task_id=$1`, [taskId],
    );
    const runId = r0[0].id;
    // 前提断言：run 带非空 controller_session_id（刀二已修）→ 过期回收 cause 必为 controller_lease_expired 而非 no_controller_ownership。
    expect(r0[0].controller_session_id).toBeTruthy();
    // 容器已死：execFn 返回空 → renewLiveRelayLeases 不续租该 run。
    const t10 = new Date(Date.now() + 10 * 60 * 1000);
    const scan = await renewLiveRelayLeases(testPool, {
      execFn: () => '', now: t10, leaseSeconds: CONTROLLER_LEASE_DEFAULT_SECONDS,
    });
    expect(scan.renewed.find((x) => x.runId === runId)).toBeUndefined();
    // t+31min（>30min 原始 lease，未续租）reconcile → 回收，cause=controller_lease_expired（有 session 但 lease 过期）。
    const t31 = new Date(Date.now() + 31 * 60 * 1000);
    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: t31 });
    const rec = recovered.find((r) => r.taskId === taskId);
    expect(rec).toBeDefined();
    expect(rec.cause).toBe('controller_lease_expired');
    const { rows } = await testPool.query(`SELECT phase FROM initiative_runs WHERE id=$1`, [runId]);
    expect(rows[0].phase).toBe('failed');
  });
});
