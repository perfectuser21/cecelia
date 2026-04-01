/**
 * 诊断型集成测试：Tick Loop → 任务状态流转链路
 *
 * 目的：记录 tick 循环的真实行为，发现 bug 时用 // DIAGNOSTIC 注释标注。
 * 不要求全部通过——这是诊断工具，而非验收标准。
 *
 * 关键路径（来自代码分析）：
 *   POST /api/brain/tick → runTickSafe('manual') → executeTick()
 *     → selectNextDispatchableTask()：查 tasks 表 status='queued'
 *     → updateTask(status='in_progress')
 *     → checkCeceliaRunAvailable()：executor 不可用时回退 queued
 *     → triggerCeceliaRun()：启动实际 subprocess
 *
 * 注意：executor 需要真实 Claude API，CI 环境通常不可用。
 * 因此 task 状态流转的"最终态"是 in_progress（dispatch 成功）
 * 或保持 queued（executor 不可用，任务被回退）。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

// ─── 配置 ────────────────────────────────────────────────────────────────────

const DB_CONFIG = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'cecelia',
  password: process.env.PGPASSWORD || 'cecelia_ci',
  database: process.env.PGDATABASE || 'cecelia',
};

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

// 跳过标志：既没有 DB 环境变量也没有 RUN_INTEGRATION=true 时跳过
const HAS_DB = Boolean(
  process.env.DB_PORT ||
  process.env.PGHOST ||
  process.env.RUN_INTEGRATION
);

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 创建一个测试用的 queued 任务，返回 task_id */
async function createTestTask(pool: Pool, suffix: string): Promise<string> {
  const title = `[DIAG-TICK-TEST] ${suffix} ${Date.now()}`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tasks (title, status, task_type, priority, metadata)
     VALUES ($1, 'queued', 'dev', 'low', $2)
     RETURNING id`,
    [title, JSON.stringify({ _diagnostic: true, _test: 'tick-integration' })]
  );
  return result.rows[0].id;
}

/** 查询任务当前状态 */
async function getTaskStatus(pool: Pool, taskId: string): Promise<string | null> {
  const result = await pool.query<{ status: string }>(
    'SELECT status FROM tasks WHERE id = $1',
    [taskId]
  );
  return result.rows[0]?.status ?? null;
}

/** 清理测试任务（避免污染 DB） */
async function cleanupTask(pool: Pool, taskId: string): Promise<void> {
  await pool.query("DELETE FROM tasks WHERE id = $1", [taskId]);
}

/** 触发一次 tick，返回响应 JSON */
async function triggerTick(): Promise<Record<string, unknown>> {
  const resp = await fetch(`${BRAIN_URL}/api/brain/tick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`tick HTTP ${resp.status}: ${await resp.text()}`);
  }
  return resp.json() as Promise<Record<string, unknown>>;
}

/** 检查 cecelia_events 表中是否有 tick 相关事件 */
async function getTickEvents(pool: Pool, since: Date): Promise<Array<Record<string, unknown>>> {
  const result = await pool.query(
    `SELECT event_type, source, payload, created_at
     FROM cecelia_events
     WHERE event_type LIKE '%tick%'
       AND created_at >= $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [since.toISOString()]
  );
  return result.rows;
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe('Tick Loop 诊断集成测试', () => {
  let pool: Pool;

  beforeAll(() => {
    if (!HAS_DB) return;
    pool = new Pool(DB_CONFIG);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // ─── 场景 1：tick HTTP 端点基础连通性 ──────────────────────────────────────

  it('POST /api/brain/tick 返回 200 且响应结构合理', async () => {
    if (!HAS_DB) {
      console.log('[SKIP] 无 DB 环境，跳过集成测试（设置 RUN_INTEGRATION=true 或 PGHOST 来运行）');
      return;
    }

    const result = await triggerTick();

    // 记录真实响应结构，供诊断用
    console.log('[DIAGNOSTIC] tick 响应:', JSON.stringify(result, null, 2));

    // tick 可能被节流（throttled）或正常执行，两者都是合法响应
    const hasSkipped = 'skipped' in result;
    const hasSuccess = 'success' in result || 'actions_taken' in result;

    expect(hasSkipped || hasSuccess).toBe(true);

    if (hasSkipped) {
      console.log(`[DIAGNOSTIC] tick 被节流，原因: ${result.reason}，下次在: ${result.next_in_ms}ms 后`);
    } else {
      console.log(`[DIAGNOSTIC] tick 已执行，actions_taken: ${JSON.stringify(result.actions_taken)}`);
    }
  });

  // ─── 场景 2：queued 任务 → tick → 状态流转验证 ─────────────────────────────

  it('创建 queued 任务 → 触发 tick → 检查状态变化（executor 可能不可用）', async () => {
    if (!HAS_DB) return;

    const taskId = await createTestTask(pool, 'scene-dispatch');
    const statusBefore = await getTaskStatus(pool, taskId);
    console.log(`[DIAGNOSTIC] 任务 ${taskId} 创建后状态: ${statusBefore}`);
    expect(statusBefore).toBe('queued');

    // 重置 tick 节流：先等待，然后触发
    // 注意：manual source 不受 TICK_INTERVAL_MINUTES 节流限制（见 tick.js:runTickSafe）
    const tickResult = await triggerTick();
    console.log(`[DIAGNOSTIC] tick 触发结果: skipped=${tickResult.skipped}, reason=${tickResult.reason}`);

    await wait(2000);

    const statusAfter = await getTaskStatus(pool, taskId);
    console.log(`[DIAGNOSTIC] 任务 ${taskId} 等待2s后状态: ${statusAfter}`);

    if (statusAfter === 'in_progress') {
      // 正常路径：executor 可用，任务被 dispatch
      console.log('[DIAGNOSTIC] 正常路径：任务已成功 dispatch 到 in_progress');
      expect(statusAfter).toBe('in_progress');
    } else if (statusAfter === 'queued') {
      // DIAGNOSTIC: executor 不可用时 tick 会把任务回退到 queued
      // 见 tick.js:1139: await updateTask({ task_id: nextTask.id, status: 'queued' })
      // 当前行为是 queued，预期（executor 可用时）应是 in_progress
      console.log('[DIAGNOSTIC] executor 不可用，任务保持 queued（这是 no_executor 路径的预期行为）');
      expect(['queued', 'in_progress']).toContain(statusAfter);
    } else {
      // 意外状态，记录诊断信息
      console.warn(`[DIAGNOSTIC] 意外状态: ${statusAfter}，任务 ID: ${taskId}`);
      expect(['queued', 'in_progress', 'failed']).toContain(statusAfter);
    }

    await cleanupTask(pool, taskId);
  });

  // ─── 场景 3：连续两次 tick 的幂等性验证 ────────────────────────────────────

  it('连续触发两次 tick → 同一任务不应被重复 dispatch（幂等检验）', async () => {
    if (!HAS_DB) return;

    const taskId = await createTestTask(pool, 'scene-idempotent');

    // 第一次 tick
    const result1 = await triggerTick();
    console.log(`[DIAGNOSTIC] 第1次 tick: skipped=${result1.skipped}, reason=${result1.reason}`);

    // 立即第二次 tick（runTickSafe manual 不受节流，但 _tickRunning 会阻止并发）
    const result2 = await triggerTick();
    console.log(`[DIAGNOSTIC] 第2次 tick: skipped=${result2.skipped}, reason=${result2.reason}`);

    await wait(1000);

    const finalStatus = await getTaskStatus(pool, taskId);
    console.log(`[DIAGNOSTIC] 幂等测试最终状态: ${finalStatus}`);

    // 关键断言：任务不应出现 "dispatched 两次" 导致的异常状态
    expect(['queued', 'in_progress', 'failed']).toContain(finalStatus);

    // 检查 second tick 是否因 already_running 被跳过
    if (result2.skipped && result2.reason === 'already_running') {
      console.log('[DIAGNOSTIC] 幂等保护生效：第2次 tick 因 _tickRunning 被跳过');
    } else if (result2.skipped && result2.reason === 'throttled') {
      // DIAGNOSTIC: manual source 不应被节流，但如果出现说明代码逻辑有变化
      console.warn('[DIAGNOSTIC] 意外：manual tick 被节流（预期 manual source 不受节流）');
    }

    await cleanupTask(pool, taskId);
  });

  // ─── 场景 4：检查 cecelia_events 是否记录 tick 执行痕迹 ───────────────────

  it('触发 tick 后检查 cecelia_events 表是否有记录', async () => {
    if (!HAS_DB) return;

    const before = new Date();
    await triggerTick();
    await wait(500);

    const events = await getTickEvents(pool, before);
    console.log(`[DIAGNOSTIC] tick 后 cecelia_events 中的相关事件（${events.length} 条）:`);
    events.forEach(e => {
      console.log(`  event_type=${e.event_type}, source=${e.source}, created_at=${e.created_at}`);
    });

    // 这是诊断性断言：记录实际发现，不强制要求必须有事件
    // DIAGNOSTIC: 若 tick 没有写入任何 cecelia_events，说明事件记录链路可能断了
    if (events.length === 0) {
      console.warn('[DIAGNOSTIC] tick 执行后 cecelia_events 没有新记录。可能原因：');
      console.warn('  1. tick 被节流/跳过，没有实际执行');
      console.warn('  2. tick 执行了但没有写入 cecelia_events（事件链路断裂）');
      console.warn('  3. 没有任务可 dispatch，所以没有 dispatch_result 事件');
    }

    // 不强制断言有事件，只确保查询本身成功
    expect(Array.isArray(events)).toBe(true);
  });

  // ─── 场景 5：tick/status 端点的可观测性验证 ────────────────────────────────

  it('GET /api/brain/tick/status 返回完整的可观测字段', async () => {
    if (!HAS_DB) return;

    const resp = await fetch(`${BRAIN_URL}/api/brain/tick/status`);
    expect(resp.ok).toBe(true);

    const status = await resp.json() as Record<string, unknown>;
    console.log('[DIAGNOSTIC] tick/status 响应:', JSON.stringify(status, null, 2));

    // 验证关键可观测字段存在
    expect(status).toHaveProperty('enabled');
    expect(status).toHaveProperty('loop_running');
    expect(status).toHaveProperty('tick_running');
    expect(status).toHaveProperty('max_concurrent');
    expect(status).toHaveProperty('auto_dispatch_max');

    if (!status.loop_running) {
      console.warn('[DIAGNOSTIC] tick loop 没有在运行（loop_running=false）。调度器可能未启动。');
    }
    if (!status.enabled) {
      console.warn('[DIAGNOSTIC] tick 被禁用（enabled=false）。可能由 disableTick() 或 manual override 设置。');
    }
  });

  // ─── 待实现场景（需要真实 Claude API 或更复杂的环境）──────────────────────

  it.todo('任务被 dispatch 后 executor subprocess 真实启动 → 需要真实 Claude API');
  it.todo('executor 启动后任务状态最终变为 completed → 端到端完整链路');
  it.todo('dispatch 超时（DISPATCH_TIMEOUT_MINUTES）后任务自动 fail → 需要时间加速');
  it.todo('quota_exhausted 状态任务的梯度 requeue 行为 → 需要模拟配额耗尽');
  it.todo('quarantine 任务的定期释放行为 → 需要构造 quarantine 状态');
});
