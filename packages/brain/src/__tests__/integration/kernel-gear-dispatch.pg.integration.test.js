/**
 * [BEHAVIOR] kernel 真读 gear：initiative_runs.gear round-trip + observed.gear 注入 +
 * hotfix 一跳角色分布（sprint 08091640）。真 Postgres 集成——真 migrate（含 396）+ 真
 * createKernelRun + 真 collectGroundTruth + 真 derive + 真 attemptStore，仅替身最外层 launcher。
 *
 * 禁 mock 边（合同「禁 mock 边清单」）：
 *  - 代码 ↔ initiative_runs.gear 列：真 pool 连真 PG，禁 mock pool.query 顶替 INSERT/SELECT。
 *  - collectGroundTruth(run 行) ↔ derive.observed.gear：真 collectGroundTruth 现查 run 行注入。
 *  - derive 首跳 action → harness_attempts.role：真 derive + 真 attemptStore，只替身 dispatch/launcher。
 *
 * 登记进 vitest.config.js 的 POSTGRES_INTEGRATION_TESTS，由 brain-integration job 起真 PG 跑。
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { derive } from '../../orchestrator/derive.js';
import { deriveCounters } from '../../orchestrator/counters.js';
import { collectGroundTruth } from '../../orchestrator/ground-truth.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { resolveAction } from '../../orchestrator/dispatcher.js';
import { runLoop } from '../../orchestrator/loop.js';
import {
  createRoutedKernelRun,
  seedRoutedKernelTask,
} from './helpers/routed-kernel-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CALLBACK_TOKEN = 'kernel-gear-callback-token';

let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^kernel_gear_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function createIsolatedDatabase() {
  databaseName = `kernel_gear_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  // statement_timeout 兜底：teardown 里任何一条清理语句都不许无限挂起，超 10s 即抛错被
  // .catch 吞掉，保证 afterAll 钩子远在 30s 上限内收尾（leaked 测试库无害——每进程库名唯一、
  // CI postgres 服务随 job 销毁）。
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1, statement_timeout: 10_000 });
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  // 真跑仓库真实迁移（migrate.js 按文件名序执行至 396），gear 列由 396 落库。
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
    // 不用 DROP DATABASE ... WITH (FORCE)：FORCE 会发一个 cluster 级 ProcSignalBarrier，等待集群
    // 内每一个 backend（含与本库无关、卡在认证阶段的连接）应答后才落库。CI 上曾有别的进程连接
    // 卡在认证达 authentication_timeout(60s)，令 FORCE drop 挂起超过 afterAll 的 30s 钩子上限——且
    // 语句是「挂起」而非「抛错」，原 try/catch 兜底根本轮不到（dod-behavior-dynamic 实测 hook timeout）。
    // 改为「禁新连接 → 定向踢本库连接 → 普通 DROP」：只针对本库、无全局屏障，不受无关 backend 影响。
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

async function seedTask(gear) {
  const initiativeId = randomUUID();
  const taskId = randomUUID();
  const payload = {
    harness_runtime: 'kernel-v1',
    orchestrator: 'skill-relay',
    sprint_dir: `sprints/08091640-gear-${taskId.slice(0, 8)}`,
    worktree_path: '/workspace',
    base_repo: 'perfectuser21/cecelia',
    initiative_id: initiativeId,
    ...(gear === undefined ? {} : { gear }),
  };
  return seedRoutedKernelTask(testPool, {
    titlePrefix: 'kernel-gear',
    initiativeId,
    taskId,
    changeKind: gear === 'hotfix' ? 'bugfix' : 'new_capability',
    payload,
  });
}

// collectGroundTruth 的外部观测替身（launcher/世界的读侧）：fileExists 返回 false ⇒ prdExists=false
// （初始态，default 从这里进 planner、hotfix 从这里分叉进 generate）；execCmd 只回空的 gh/git/docker。
function externalObservation() {
  return {
    execCmd(command) {
      if (command.startsWith('gh pr view ')) {
        return JSON.stringify({ state: 'OPEN', statusCheckRollup: [] });
      }
      if (command.startsWith('git ls-remote ')) return '';
      if (command.startsWith('docker ps ')) return '';
      return '';
    },
    fileExists() { return false; },
    readFile() { return ''; },
    listHostPids: async () => [],
  };
}

async function collect(taskId, runId, payload) {
  return collectGroundTruth(
    { pool: testPool, ...externalObservation() },
    {
      taskId,
      runId,
      prdPath: `${payload.sprint_dir}/sprint-prd.md`,
      callbackResultPath: '.kernel-gear-no-callback-file',
    },
  );
}

class StopLoopAfterDispatch extends Error {}

// 一跳驱动 runLoop：真 collectGroundTruth + 真 derive + 真 attemptStore，dispatch（最外层
// launcher 边界）建 harness_attempts 行后抛哨兵停机——首个真派发已落库，供 psql 断言角色分布。
async function driveOneHop({ taskId, runId, payload }) {
  const attemptStore = createAttemptStore(testPool);
  let dispatchedAction = null;
  let dispatchedRole = null;
  try {
    await runLoop(
      {
        pool: testPool,
        collectGroundTruth: () => collect(taskId, runId, payload),
        writeHeartbeat: async () => {},
        now: () => new Date(),
        host: 'kernel-gear-test',
        pid: process.pid,
        log: () => {},
        sleep: async () => {},
        impactGate: {
          beforeGenerate: async () => ({ gate: 'pass', stage: 'kernel-gear-fixture' }),
          beforeEvaluate: async () => ({ gate: 'pass', stage: 'kernel-gear-fixture' }),
          beforeMerge: async () => ({ gate: 'pass', stage: 'kernel-gear-fixture' }),
        },
        dispatch: async (action, ctx) => {
          dispatchedAction = action;
          dispatchedRole = resolveAction(action).role; // 真 dispatcher 的 action→role 映射
          await attemptStore.createAttempt({
            id: randomUUID(),
            runId,
            hop: ctx.hop,
            phase: ctx.decision.phase,
            role: dispatchedRole,
            provider: 'codex',
            machineId: 'us-mac-m4',
            bundle: {
              inputs: {
                task_id: taskId,
                sprint_dir: payload.sprint_dir,
                worktree_path: '/workspace',
              },
            },
            callbackSecretHash: createHash('sha256').update(CALLBACK_TOKEN).digest('hex'),
          });
          throw new StopLoopAfterDispatch(); // 观测到首个真派发即停机（只替身最外层 launcher）
        },
      },
      { taskId, runId },
    );
  } catch (err) {
    if (!(err instanceof StopLoopAfterDispatch)) throw err;
  }
  return { dispatchedAction, dispatchedRole };
}

beforeAll(createIsolatedDatabase, 60_000);
afterAll(dropIsolatedDatabase, 30_000);

describe('kernel gear：initiative_runs.gear round-trip + observed.gear 注入（真 PG）', () => {
  it('gear 列可 round-trip 且 collectGroundTruth 注入 observed.gear 等于持久化值（hotfix，真 PG）', async () => {
    const { initiativeId, taskId, payload } = await seedTask('hotfix');
    const created = await createRoutedKernelRun(testPool, {
      taskId,
      initiativeId,
      phase: 'planning',
      journeyId: null,
      abilityId: null,
      host: 'kernel-v1',
      deadlineHours: 8,
      createdSource: 'kernel_dispatch',
      controllerSessionId: randomUUID(),
      gear: 'hotfix',
    });
    expect(created.created).toBe(true);
    const runId = created.run.id;

    const stored = await testPool.query(
      "SELECT gear FROM initiative_runs WHERE id=$1",
      [runId],
    );
    expect(stored.rows[0].gear).toBe('hotfix');

    const observed = await collect(taskId, runId, payload);
    expect(observed.gear).toBe('hotfix');
  });

  it('gear 缺省时列写 NULL 且 collectGroundTruth 降级 observed.gear===default（零回归边界）', async () => {
    const { initiativeId, taskId, payload } = await seedTask(undefined);
    const created = await createRoutedKernelRun(testPool, {
      taskId,
      initiativeId,
      phase: 'planning',
      journeyId: null,
      abilityId: null,
      host: 'kernel-v1',
      deadlineHours: 8,
      createdSource: 'kernel_dispatch',
      controllerSessionId: randomUUID(),
      // gear 不传 → 列 NULL
    });
    const runId = created.run.id;

    const stored = await testPool.query(
      "SELECT gear FROM initiative_runs WHERE id=$1",
      [runId],
    );
    expect(stored.rows[0].gear).toBeNull();

    const observed = await collect(taskId, runId, payload);
    expect(observed.gear).toBe('default');
  });
});

describe('kernel gear：hotfix run 一跳角色分布（真 collectGroundTruth+derive+attemptStore）', () => {
  it('hotfix 首角色 generator 无 planner/proposer/reviewer；default 首角色 planner（真 PG，时间窗防伪）', async () => {
    // hotfix run：初始态 derive 直进 generate → 首角色 generator
    const hotfix = await seedTask('hotfix');
    const hotfixRun = await createRoutedKernelRun(testPool, {
      taskId: hotfix.taskId,
      initiativeId: hotfix.initiativeId,
      phase: 'planning',
      journeyId: null,
      abilityId: null,
      host: 'kernel-v1',
      deadlineHours: 8,
      createdSource: 'kernel_dispatch',
      controllerSessionId: randomUUID(),
      gear: 'hotfix',
    });
    // observed.gear 真注入后 derive 分叉（纯函数断言，先于 loop 驱动确认分叉方向）
    const hotfixObserved = await collect(hotfix.taskId, hotfixRun.run.id, hotfix.payload);
    const hotfixDecision = derive({
      ...hotfixObserved,
      counters: deriveCounters(hotfixObserved.decisionLog, {
        proposeBranchMaxRn: hotfixObserved.proposeBranchRn,
      }),
    });
    expect(hotfixDecision.action).toBe('spawn:generator');

    const hotfixDispatch = await driveOneHop({
      taskId: hotfix.taskId,
      runId: hotfixRun.run.id,
      payload: hotfix.payload,
    });
    expect(hotfixDispatch.dispatchedAction).toBe('spawn:generator');
    expect(hotfixDispatch.dispatchedRole).toBe('generator');

    // default run：零回归锚点——初始态 derive 仍进 planning → 首角色 planner
    const def = await seedTask('default');
    const defRun = await createRoutedKernelRun(testPool, {
      taskId: def.taskId,
      initiativeId: def.initiativeId,
      phase: 'planning',
      journeyId: null,
      abilityId: null,
      host: 'kernel-v1',
      deadlineHours: 8,
      createdSource: 'kernel_dispatch',
      controllerSessionId: randomUUID(),
      gear: 'default',
    });
    const defDispatch = await driveOneHop({
      taskId: def.taskId,
      runId: defRun.run.id,
      payload: def.payload,
    });
    expect(defDispatch.dispatchedAction).toBe('spawn:planner');
    expect(defDispatch.dispatchedRole).toBe('planner');

    // psql 出口断言（与 E2E step 4/5 同口径，时间窗防历史数据冒充）：
    const bad = await testPool.query(
      `SELECT count(*)::int AS c FROM harness_attempts a
         JOIN initiative_runs r ON r.id=a.run_id
        WHERE r.gear='hotfix' AND a.role IN ('planner','proposer','reviewer')
          AND a.created_at > NOW() - interval '10 minutes'`,
    );
    expect(bad.rows[0].c).toBe(0);
    const gen = await testPool.query(
      `SELECT count(*)::int AS c FROM harness_attempts a
         JOIN initiative_runs r ON r.id=a.run_id
        WHERE r.gear='hotfix' AND a.role='generator'
          AND a.created_at > NOW() - interval '10 minutes'`,
    );
    expect(gen.rows[0].c).toBeGreaterThanOrEqual(1);
    const planner = await testPool.query(
      `SELECT count(*)::int AS c FROM harness_attempts a
         JOIN initiative_runs r ON r.id=a.run_id
        WHERE COALESCE(r.gear,'default')='default' AND a.role='planner'
          AND a.created_at > NOW() - interval '10 minutes'`,
    );
    expect(planner.rows[0].c).toBeGreaterThanOrEqual(1);
  });
});
