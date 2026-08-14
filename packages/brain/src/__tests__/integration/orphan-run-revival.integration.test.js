/**
 * TOP2 刀1 回归:孤儿 run 复活 + spawn-guard 死锁解(task f4f28298)
 *
 * 真连 Postgres(DB_NAME=cecelia_scratch),不 mock db.js —— 本单三个 bug 里有两个
 * 只有打真 schema 才看得见,mock pool 会把它们全遮住:
 *
 *   ① 死锁:orphan-guard 把 task 打回 queued 却不动 initiative_runs,
 *      spawn-guard 按"还有活跃 run"一路拒重派,直到 requeue 超限终态 failed。
 *      实证 2026-08-07:W1/W2/W3 三条 harness_initiative 全灭,
 *      日志里 "refusing duplicate spawn" 与 "requeued (第N次)" 交替刷了 40 分钟。
 *   ② startup-sync 的 SELECT 引用了 initiative_runs 上根本不存在的三列
 *      (tmux_session / last_container_exit_code / stdout_tail),每次 Brain 启动必抛
 *      "column r.tmux_session does not exist",被 server.js 的 catch 当 non-fatal 咽掉——
 *      唯一的开机孤儿复活路径自诞生起 100% 空转。单测 mock 掉 pool 就永远发现不了。
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { requeueOrphanTask } from '../../lib/harness-orphan-guard.js';
import { findActiveRunBlockingSpawn } from '../../lib/harness-run-guard.js';
import {
  scanOrphanedRelayTasks,
  reviveOrphanedHarnessTasks,
  REVIVAL_ERROR_SIGNATURE,
} from '../../startup-sync.js';
import { seedOwnedActiveV2Run } from './helpers/controller-authority-fixture.js';

// 固定命名空间,避免与 scratch 库里其它实现者的 fixture 互踩
const NS = `orphan-revival-itest-${process.pid}`;
const TASK_ID = '0b7df1ca-da50-4928-9d24-000000000001';
const RUN_ID = '0b7df1ca-da50-4928-9d24-000000000002';

const noContainer = () => '';

async function cleanup() {
  await pool.query('DELETE FROM initiative_runs WHERE id = $1', [RUN_ID]);
  await pool.query('DELETE FROM tasks WHERE id = $1 OR title = $2', [TASK_ID, NS]);
}

/**
 * 造一具"run 非终态未过期"的现场。
 *
 * 时序必须照抄生产:任务先 in_progress 建 run,之后任务才变终态——
 * DB 触发器 lock_initiative_run_insert_identity 不允许把活跃 v2 run 直接插到终态任务上,
 * 而生产里那三条正是"run 建完之后任务被 orphan-guard 打成 failed、run 却没人管"
 * 才留下的悬空活跃行(本单要根治的正是这个)。
 */
async function seed({ taskStatus, errorMessage = null, payload = {}, runPhase = 'B_task_loop' }) {
  await cleanup();
  await pool.query(
    `INSERT INTO tasks (id, title, status, task_type, payload, updated_at)
     VALUES ($1, $2, 'in_progress', 'harness_initiative', $3::jsonb, NOW() - INTERVAL '30 minutes')`,
    [TASK_ID, NS, JSON.stringify({ orchestrator: 'skill-relay', ...payload })]
  );
  if (runPhase === 'done') {
    await pool.query(
      `INSERT INTO initiative_runs
         (id, initiative_id, current_task_id, phase, orchestrator_version,
          orchestrator_host, created_source, deadline_at)
       VALUES ($1, $2, $2, $3, 'v2', 'skill-relay-session', 'legacy_relay',
               NOW() + INTERVAL '6 hours')`,
      [RUN_ID, TASK_ID, runPhase]
    );
  } else {
    await seedOwnedActiveV2Run(pool, {
      runId: RUN_ID,
      initiativeId: TASK_ID,
      taskId: TASK_ID,
      phase: runPhase,
      createdSource: 'legacy_relay',
      orchestratorHost: 'skill-relay-session',
      deadlineAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    });
  }
  if (taskStatus !== 'in_progress') {
    await pool.query(
      `UPDATE tasks SET status = $2, error_message = $3,
                        updated_at = NOW() - INTERVAL '30 minutes'
       WHERE id = $1`,
      [TASK_ID, taskStatus, errorMessage]
    );
  }
}

const runPhase = async () => (await pool.query(
  'SELECT phase, failure_reason, completed_at FROM initiative_runs WHERE id = $1', [RUN_ID])).rows[0];
const taskRow = async () => (await pool.query(
  'SELECT status, payload, claimed_by, error_message FROM tasks WHERE id = $1', [TASK_ID])).rows[0];

beforeEach(cleanup);
afterAll(async () => { await cleanup(); });

describe('① spawn-guard 死锁解', () => {
  it('收割前:非终态未过期的 run 会挡住重新 spawn(死锁现场复现)', async () => {
    await seed({ taskStatus: 'in_progress' });
    const blocking = await findActiveRunBlockingSpawn(pool, TASK_ID);
    expect(blocking?.id).toBe(RUN_ID);
  });

  it('orphan 收割 requeue 时同步终态化 run → 重派不再被拒', async () => {
    await seed({ taskStatus: 'in_progress' });

    const r = await requeueOrphanTask(
      pool, { id: TASK_ID, payload: {} }, 'sweep-orphan(idle>15min,无活容器)'
    );
    expect(r.action).toBe('requeued');

    // run 已终态化,且写清死因
    const run = await runPhase();
    expect(run.phase).toBe('failed');
    expect(run.failure_reason).toBe('container_orphaned');
    expect(run.completed_at).not.toBeNull();

    // 死锁真的解了:同一把守卫现在放行
    expect(await findActiveRunBlockingSpawn(pool, TASK_ID)).toBeNull();

    // task 正常回 queued
    expect((await taskRow()).status).toBe('queued');
  });

  it('requeue 超限转 failed 时同样终态化 run(不留悬空活跃行)', async () => {
    await seed({ taskStatus: 'in_progress' });
    const r = await requeueOrphanTask(
      pool, { id: TASK_ID, payload: { orphan_requeue_count: 3 } }, 'capped'
    );
    expect(r.action).toBe('failed');
    expect((await runPhase()).phase).toBe('failed');
    expect(await findActiveRunBlockingSpawn(pool, TASK_ID)).toBeNull();
  });

  it('已 done 的 run 不被收割改写(只动非终态行)', async () => {
    await seed({ taskStatus: 'in_progress', runPhase: 'done' });
    await requeueOrphanTask(pool, { id: TASK_ID, payload: {} }, 'x');
    expect((await runPhase()).phase).toBe('done');
  });
});

describe('② startup-sync 打真 schema', () => {
  it('scanOrphanedRelayTasks 的 SELECT 能在真库跑通(旧版引用不存在的列必抛)', async () => {
    await seed({ taskStatus: 'in_progress' });
    const spawnFn = async () => ({ containerId: 'noop' });
    // 旧实现在这里抛 "column r.tmux_session does not exist"
    const r = await scanOrphanedRelayTasks({ pool, spawnFn, classifyFn: () => ({ cause: 'unknown', action: 'log_only' }) });
    expect(r.scanned).toBeGreaterThanOrEqual(1);
  });

  it('exit code 从 tasks.payload 取(它本来就写在这儿,不在 initiative_runs 上)', async () => {
    await seed({ taskStatus: 'in_progress', payload: { last_container_exit_code: 137 } });
    const seen = [];
    await scanOrphanedRelayTasks({
      pool,
      spawnFn: async () => ({ containerId: 'noop' }),
      classifyFn: (args) => { seen.push(args); return { cause: 'unknown', action: 'log_only' }; },
    });
    expect(seen.some((a) => a.exitCode === 137)).toBe(true);
  });
});

describe('③ 孤儿复活', () => {
  const cappedError = `${REVIVAL_ERROR_SIGNATURE}(3次),终态 failed: sweep-orphan(idle>15min,无活容器)`;

  it('基础设施死因的 failed 任务被复活:回 queued + 计数重置 + run 终态化 + 留痕', async () => {
    await seed({
      taskStatus: 'failed',
      errorMessage: cappedError,
      payload: { orphan_requeue_count: 3 },
    });

    const r = await reviveOrphanedHarnessTasks({ pool, execFn: noContainer });
    expect(r.revived).toBe(1);

    const t = await taskRow();
    expect(t.status).toBe('queued');
    expect(t.claimed_by).toBeNull();
    expect(t.payload.orphan_requeue_count).toBe(0);
    expect(t.payload.harness_revival_count).toBe(1);
    expect(t.payload.revived_from.previous_error).toContain('requeue 超限');

    // 复活后必须是"干净可重跑"的:残留 run 已终态化,重派不会再撞 guard
    expect((await runPhase()).phase).toBe('failed');
    expect(await findActiveRunBlockingSpawn(pool, TASK_ID)).toBeNull();
  });

  it('业务失败的 failed 任务不被复活(failed 不能回 queued 的规则只对 infra 死因开口子)', async () => {
    await seed({
      taskStatus: 'failed',
      errorMessage: 'Evaluator verdict=FAIL: 合同未满足',
    });
    const r = await reviveOrphanedHarnessTasks({ pool, execFn: noContainer });
    expect(r.revived).toBe(0);
    expect((await taskRow()).status).toBe('failed');
  });

  it('已复活过一次的任务不再复活(封顶,防每次启动复活一次)', async () => {
    await seed({
      taskStatus: 'failed',
      errorMessage: cappedError,
      payload: { harness_revival_count: 1 },
    });
    const r = await reviveOrphanedHarnessTasks({ pool, execFn: noContainer, maxRevivals: 1 });
    expect(r.revived).toBe(0);
    expect((await taskRow()).status).toBe('failed');
  });
});
