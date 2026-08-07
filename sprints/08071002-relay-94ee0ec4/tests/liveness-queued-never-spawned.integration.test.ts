/**
 * liveness-queued-never-spawned.integration.test.ts [BEHAVIOR]
 *
 * TDD Red 证据（vitest）— 修复「queued 任务从未 spawn 却被 liveness watchdog 按
 * never_started 杀死」失败模式（task 94ee0ec4 / 事故任务 b35bfa0c）。
 *
 * 事故形态复现：任务被翻 in_progress 但零留痕（无 activeProcesses 条目、无
 * /tmp/cecelia-<id>.log、无 error_message、无 task_events/dispatch_events 行），
 * payload.headed_manual=true —— 现状被双确认探测判 never_started 并写 watchdog_kill。
 *
 * 禁 mock 被测边（合同「禁 mock 边清单」执法对象）：真连 Postgres（不 mock db.js）、
 * 真 executor.js 模块、真 ps 进程探测（随机 UUID 天然无进程）。零 vi.mock。
 *
 * 毕业目标：packages/brain/src/__tests__/integration/liveness-queued-never-spawned.integration.test.js
 * 登记 vitest.config.js POSTGRES_INTEGRATION_TESTS，永久回归入 CI（brain-integration job）。
 * 毕业仅允许改 import 相对路径与去除 TS 类型标注，describe/it 名与 expect 断言逐字不变。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { writeFileSync, rmSync } from 'fs';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

let pool: any;
let probeTaskLiveness: () => Promise<unknown>;
let suspectProcesses: Map<string, unknown>;
const seededIds: string[] = [];
const tmpLogs: string[] = [];

beforeAll(async () => {
  pool = (await import('../../../packages/brain/src/db.js')).default;
  const executor = await import('../../../packages/brain/src/executor.js');
  probeTaskLiveness = executor.probeTaskLiveness;
  suspectProcesses = executor.suspectProcesses;
});

afterEach(async () => {
  suspectProcesses.clear();
  while (seededIds.length) {
    const id = seededIds.pop();
    await pool.query('DELETE FROM learnings WHERE task_id = $1', [id]);
    await pool.query('DELETE FROM task_events WHERE task_id = $1', [id]);
    await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
  }
  while (tmpLogs.length) {
    try { rmSync(tmpLogs.pop() as string); } catch { /* already gone */ }
  }
});

async function seedTask(overrides: Record<string, unknown> = {}) {
  const {
    started_at = null,
    error_message = null,
    payload = {},
    title = `liveness-queued-never-spawned fixture ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  } = overrides as any;
  const r = await pool.query(
    `INSERT INTO tasks (title, task_type, status, payload, error_message, started_at)
     VALUES ($1, 'dev', 'in_progress', $2, $3, $4) RETURNING id`,
    [title, JSON.stringify(payload), error_message, started_at]
  );
  const id = r.rows[0].id;
  seededIds.push(id);
  return id;
}

async function readTask(id: string) {
  const r = await pool.query(
    'SELECT status, error_message, payload FROM tasks WHERE id = $1',
    [id]
  );
  return r.rows[0];
}

async function doubleConfirmProbe() {
  // 真实两轮探针：第一轮标 suspect，第二轮确认——suspect 状态跨轮真实保留
  await probeTaskLiveness();
  await probeTaskLiveness();
}

describe('queued 未 spawn 任务 liveness 假杀修复 [BEHAVIOR]', () => {
  it('headed_manual=true 零留痕未 spawn 任务双确认探测后不被打 watchdog_kill 且不置 failed', async () => {
    // 事故形态：headed_manual=true、started_at=null、无 error_message、无进程日志、pid 未跟踪。
    // 现状 Red：isNeverStarted 三信号联合判 true → requeueTask 写 payload.watchdog_kill。
    // 修复语义（headed_manual 消费方向，PRD FR-4 + 铁律 9f14c074）：
    // headed 人工接管任务不进 liveness 假杀路径，零留痕零 spawn 证据任务不得被 kill 分类处置。
    const id = await seedTask({
      payload: { headed_manual: true },
    });

    await doubleConfirmProbe();

    const row = await readTask(id);
    expect(row.payload?.watchdog_kill).toBeUndefined();
    expect(row.status).not.toBe('failed');
    expect(row.error_message).toBeNull();
  });

  it('非 headed 未 spawn 任务被 watchdog 处置后 task_events 表有留痕行', async () => {
    // NFR 可观测（PRD：事件表留痕，本次事故 task_events 0 行即缺口）。
    // 现状 Red：executor requeueTask 只写 learnings，不写 task_events。
    // 修复后：watchdog 对该任务的任何处置（kill/requeue/安全回队）必须落 task_events ≥1 行。
    const id = await seedTask({
      payload: {},
    });

    await doubleConfirmProbe();

    // task_id 定位 + created_at 5 分钟时间窗，防历史行冒充本轮产出
    const r = await pool.query(
      `SELECT event_type FROM task_events
       WHERE task_id = $1 AND created_at > NOW() - interval '5 minutes'`,
      [id]
    );
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('护栏：带派发失败回执（error_message）的从未启动任务仍分类 never_started', async () => {
    // 防修过头护栏（现状 Green，修复后不得变 Red）：既有 1dfa40f7 语义——
    // 派发被拒且已有回执的任务，never_started 分类必须保持，且回执不被覆盖（铁律 56a0ba9f）。
    const S2_ERROR_MESSAGE =
      'S2锚点执法：task缺少 payload.anchor.{journey_id,gp_id,step_id}，拒绝点火';
    const id = await seedTask({
      error_message: S2_ERROR_MESSAGE,
      payload: { failure_class: 'missing_anchor' },
    });

    await doubleConfirmProbe();

    const row = await readTask(id);
    expect(row.payload?.watchdog_kill?.reason).toBe('never_started');
    expect(row.error_message).toBe(S2_ERROR_MESSAGE);
    expect(row.payload?.failure_class).toBe('missing_anchor');
  });

  it('护栏：曾启动任务（started_at 非空 + 进程日志存在）进程消失仍判 process_disappeared', async () => {
    // 防修过头护栏（现状 Green，修复后不得变 Red）：真实 spawn 后进程立死的任务
    // 仍必须被 watchdog 双确认正常捕获（PRD 边界情况第一条）。
    const id = await seedTask({
      started_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      payload: { current_run_id: 'run-replay-guard-000' },
    });
    const logPath = `/tmp/cecelia-${id}.log`;
    writeFileSync(logPath, 'process started\nworking on task\n');
    tmpLogs.push(logPath);

    await doubleConfirmProbe();

    const row = await readTask(id);
    expect(row.payload?.watchdog_kill?.reason).toBe('process_disappeared');
  });
});
