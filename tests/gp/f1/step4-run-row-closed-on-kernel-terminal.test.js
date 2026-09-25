// F1「工厂 · 开发闭环」步骤 4「交付有回执」—— 边：kernel 终态 finalizeKernelRun × run 原语 task_runs
//
// 链 bf5088a3 棒1（任务 66db3dfb）：一次执行 = 一行 task_runs。kernel run 不走 execution-callback，
// 终态只在 finalizeKernelRun 落——它提交后必须经 run 原语把同 run_id 的那一行补成终态，
// 否则每条 harness run 都会在 task_runs 里永远停在 running（悬挂），交付无回执。
//
// 真 import 被改模块 kernel-run-store.js 与真 run 原语 lib/task-run.js（守卫在边上，均不 mock），
// 仅用内存 pool 替身脚本化 SQL 响应，断言「终态提交之后」发出的 task_runs UPDATE 的参数。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { finalizeKernelRun } from '../../../packages/brain/src/orchestrator/kernel-run-store.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';

function makePool() {
  const events = [];
  const client = {
    query: vi.fn(async (sql) => {
      const text = String(sql);
      events.push({ kind: 'client', text: text.trim().split('\n')[0].trim() });
      if (/FROM tasks\s+WHERE id = \$1\s+FOR UPDATE/.test(text)) return { rows: [{ id: TASK_ID, status: 'in_progress' }] };
      if (/FROM initiative_runs\s+WHERE id = \$1\s+AND orchestrator_version = 'v2'\s+FOR UPDATE/.test(text)) {
        return {
          rows: [{
            id: RUN_ID, current_task_id: TASK_ID, phase: 'planning',
            controller_session_id: null, controller_generation: 0, controller_lease_expires_at: null,
          }],
        };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql, params) => {
      events.push({ kind: 'pool', text: String(sql).trim().split('\n')[0].trim(), params });
      return { rows: [{ id: 'run-row' }] };
    }),
  };
  return { pool, events };
}

afterEach(() => vi.restoreAllMocks());

describe('F1 step4 交付有回执：kernel run 终态提交后，task_runs 同 run_id 行补成终态', () => {
  it('outcome=done → COMMIT 之后经 run 原语把该行补成 success', async () => {
    const { pool, events } = makePool();
    const out = await finalizeKernelRun(pool, { runId: RUN_ID, expectedTaskId: TASK_ID, outcome: 'done' });
    expect(out.changed).toBe(true);

    const commitAt = events.findIndex((e) => e.kind === 'client' && e.text === 'COMMIT');
    const runUpdate = events.findIndex((e) => e.kind === 'pool' && /UPDATE task_runs/.test(e.text));
    expect(commitAt).toBeGreaterThan(-1);
    expect(runUpdate).toBeGreaterThan(commitAt);
    const upd = events[runUpdate];
    expect(upd.params[0]).toBe(RUN_ID);
    expect(upd.params[1]).toBe('success');
  });

  it('outcome=failed → 补成 failed 并带失败原因（不伪造成功）', async () => {
    const { pool, events } = makePool();
    await finalizeKernelRun(pool, {
      runId: RUN_ID, expectedTaskId: TASK_ID, outcome: 'failed', reason: 'kernel_launch_failed:boom',
    });
    const upd = events.find((e) => e.kind === 'pool' && /UPDATE task_runs/.test(e.text));
    expect(upd.params[1]).toBe('failed');
    expect(upd.params[3]).toBe('kernel_launch_failed:boom');
  });

  it('留痕失败 fail-open：task_runs 写入抛错不影响终态返回', async () => {
    const { pool } = makePool();
    pool.query = vi.fn(async () => { throw new Error('db hiccup'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await finalizeKernelRun(pool, { runId: RUN_ID, expectedTaskId: TASK_ID, outcome: 'done' });
    expect(out).toMatchObject({ changed: true, outcome: 'done', runId: RUN_ID });
  });
});
