/**
 * kernel-liveness.test.js —— Kernel v1 进程判活（刀1）
 *
 * 事故背景（2026-07-27）：task 51836fb2 / run 13d41c64，
 * initiative_runs.orchestrator_heartbeat_at = 01:06:53，
 * 比该 task 被标 failed 的 01:02:37 晚 4 分 16 秒 —— controller 活着却被判死。
 * 根因：旧守卫只认两个信号（cecelia-relay-* 容器 + initiative_run_events），
 * 而 Kernel v1 是 Brain 容器内的裸 Node 进程，两个信号同时返回"死"。
 *
 * 本模块的铁律：fail-open。查询异常 / 字段缺失 / host 不匹配一律 unknown，
 * 绝不能把"我不知道"变成"它死了"。只有"host 匹配 + pid 存在 + kill 返回 ESRCH"
 * 这一条正面证据才允许判 dead。
 *
 * 依赖全注入（pool / now / hostFn / killFn），不 mock 被测模块本身。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  KERNEL_HEARTBEAT_STALE_MS,
  isKernelRuntimeTask,
  loadKernelRun,
  latestKernelHeartbeatMs,
  assessKernelLiveness,
} from '../kernel-liveness.js';

const TASK_ID = '51836fb2-10ea-48eb-97b2-c324df32d147';
const RUN_ID = '13d41c64-0000-4000-8000-000000000001';
const HOST = 'brain-container-01';

function kernelTask(over = {}) {
  return {
    id: TASK_ID,
    task_type: 'harness_initiative',
    status: 'in_progress',
    payload: { harness_runtime: 'kernel-v1' },
    ...over,
  };
}

/** 只认 initiative_runs 查询的假 pool；其余 SQL 返回空。 */
function poolWithRun(runRowValue) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      if (/FROM initiative_runs/.test(String(sql))) {
        return { rows: runRowValue ? [runRowValue] : [] };
      }
      return { rows: [] };
    }),
  };
}

function runRow(over = {}) {
  return {
    id: RUN_ID,
    initiative_id: TASK_ID,
    current_task_id: TASK_ID,
    phase: 'generating',
    orchestrator_heartbeat_at: null,
    orchestrator_pid: null,
    orchestrator_host: null,
    started_at: new Date('2026-07-27T00:30:00Z').toISOString(),
    ...over,
  };
}

describe('KERNEL_HEARTBEAT_STALE_MS', () => {
  it('取 3 分钟：kernel 等待循环每 90s 一跳，两跳 + 调度余量', () => {
    expect(KERNEL_HEARTBEAT_STALE_MS).toBe(3 * 60 * 1000);
  });
});

describe('isKernelRuntimeTask', () => {
  it('payload.harness_runtime=kernel-v1 → true', () => {
    expect(isKernelRuntimeTask(kernelTask())).toBe(true);
  });
  it('旧 relay 任务 / 空 payload / null → false（旧路径不受影响）', () => {
    expect(isKernelRuntimeTask({ id: 'x', payload: {} })).toBe(false);
    expect(isKernelRuntimeTask({ id: 'x' })).toBe(false);
    expect(isKernelRuntimeTask(null)).toBe(false);
    expect(isKernelRuntimeTask({ payload: { harness_runtime: 'relay' } })).toBe(false);
  });
});

describe('loadKernelRun', () => {
  it('只取 v2 非终态 run，身份只认 current_task_id', async () => {
    const pool = poolWithRun(runRow());
    const run = await loadKernelRun(pool, { taskId: TASK_ID });
    expect(run.id).toBe(RUN_ID);
    const q = pool.calls[0];
    expect(q.sql).toContain('initiative_runs');
    expect(q.sql).toContain("orchestrator_version = 'v2'");
    expect(q.sql).toMatch(/phase NOT IN \('done',\s*'failed'\)/);
    expect(q.sql).toContain('current_task_id');
    expect(q.sql).not.toMatch(/OR\s+initiative_id/i);
    expect(q.sql).toContain('orchestrator_heartbeat_at');
    expect(q.sql).toContain('orchestrator_pid');
    expect(q.sql).toContain('orchestrator_host');
    expect(q.params).toEqual([TASK_ID]);
  });

  it('无 run 行 → null；无 pool → null（不抛）', async () => {
    expect(await loadKernelRun(poolWithRun(null), { taskId: TASK_ID })).toBe(null);
    expect(await loadKernelRun(null, { taskId: TASK_ID })).toBe(null);
  });
});

describe('assessKernelLiveness — 旧路径不适用', () => {
  it('非 kernel-v1 任务 → not_applicable，且完全不查库（调用方继续走旧逻辑）', async () => {
    const pool = poolWithRun(runRow());
    const r = await assessKernelLiveness({ pool, task: { id: TASK_ID, payload: {} } });
    expect(r.verdict).toBe('not_applicable');
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('assessKernelLiveness — 心跳信号（第一顺位）', () => {
  it('心跳在新鲜阈值内 → alive(heartbeat)', async () => {
    const now = Date.parse('2026-07-27T01:07:30Z');
    const pool = poolWithRun(runRow({
      orchestrator_heartbeat_at: new Date('2026-07-27T01:06:53Z').toISOString(),
    }));
    const r = await assessKernelLiveness({ pool, task: kernelTask(), now: () => now });
    expect(r.verdict).toBe('alive');
    expect(r.source).toBe('heartbeat');
  });

  it('事故回归 51836fb2：判死时刻心跳只有 37s 龄 → 必须 alive，绝不能判死', async () => {
    // 实测：heartbeat 01:06:53，旧守卫在 01:07:30 这一刻仍会因"无容器 + 无 run_events"判死。
    const now = Date.parse('2026-07-27T01:07:30Z');
    const pool = poolWithRun(runRow({
      orchestrator_heartbeat_at: new Date('2026-07-27T01:06:53Z').toISOString(),
      orchestrator_pid: null,        // pid 拿不到也不影响：心跳已经证明活着
      orchestrator_host: null,
    }));
    const r = await assessKernelLiveness({ pool, task: kernelTask(), now: () => now });
    expect(r.verdict).toBe('alive');
    expect(r.heartbeatAgeMs).toBe(37 * 1000);
  });

  it('心跳超龄且无 pid → unknown，绝不 dead', async () => {
    const now = Date.parse('2026-07-27T01:20:00Z');
    const pool = poolWithRun(runRow({
      orchestrator_heartbeat_at: new Date('2026-07-27T01:00:00Z').toISOString(),
    }));
    const r = await assessKernelLiveness({ pool, task: kernelTask(), now: () => now });
    expect(r.verdict).toBe('unknown');
    expect(r.reason).toBe('no_pid');
  });

  it('心跳字段为脏值（无法解析）→ 退到 pid 信号，不当作新鲜', async () => {
    const now = Date.parse('2026-07-27T01:20:00Z');
    const pool = poolWithRun(runRow({ orchestrator_heartbeat_at: 'not-a-date' }));
    const r = await assessKernelLiveness({ pool, task: kernelTask(), now: () => now });
    expect(r.verdict).toBe('unknown');
  });
});

describe('assessKernelLiveness — pid 信号（第二顺位）', () => {
  const now = Date.parse('2026-07-27T01:20:00Z');
  const staleRun = (over = {}) => runRow({
    orchestrator_heartbeat_at: new Date('2026-07-27T01:00:00Z').toISOString(),
    orchestrator_pid: 4242,
    orchestrator_host: HOST,
    ...over,
  });

  it('host 一致 + kill(pid,0) 成功 → alive(pid)', async () => {
    const killFn = vi.fn(() => true);
    const r = await assessKernelLiveness({
      pool: poolWithRun(staleRun()), task: kernelTask(),
      now: () => now, hostFn: () => HOST, killFn,
    });
    expect(r.verdict).toBe('alive');
    expect(r.source).toBe('pid');
    expect(killFn).toHaveBeenCalledWith(4242, 0);
  });

  it('kill 抛 EPERM（进程在但无权限）→ alive', async () => {
    const killFn = vi.fn(() => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; });
    const r = await assessKernelLiveness({
      pool: poolWithRun(staleRun()), task: kernelTask(),
      now: () => now, hostFn: () => HOST, killFn,
    });
    expect(r.verdict).toBe('alive');
  });

  it('kill 抛 ESRCH（进程确实没了）→ dead —— 唯一允许判死的正面证据', async () => {
    const killFn = vi.fn(() => { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; });
    const r = await assessKernelLiveness({
      pool: poolWithRun(staleRun()), task: kernelTask(),
      now: () => now, hostFn: () => HOST, killFn,
    });
    expect(r.verdict).toBe('dead');
    expect(r.reason).toBe('pid_gone');
  });

  it('host 不一致（跨主机裸 pid 无意义）→ unknown，既不探活也不判死', async () => {
    const killFn = vi.fn(() => true);
    const r = await assessKernelLiveness({
      pool: poolWithRun(staleRun({ orchestrator_host: 'some-other-box' })), task: kernelTask(),
      now: () => now, hostFn: () => HOST, killFn,
    });
    expect(r.verdict).toBe('unknown');
    expect(r.reason).toBe('host_mismatch');
    expect(killFn).not.toHaveBeenCalled();
  });

  it('run 刚落行 host 还是占位值 kernel-v1（心跳未写）→ unknown', async () => {
    const r = await assessKernelLiveness({
      pool: poolWithRun(staleRun({ orchestrator_host: 'kernel-v1' })), task: kernelTask(),
      now: () => now, hostFn: () => HOST, killFn: vi.fn(() => true),
    });
    expect(r.verdict).toBe('unknown');
  });

  it('kill 抛未知错误码 → unknown（不猜）', async () => {
    const killFn = vi.fn(() => { const e = new Error('boom'); e.code = 'EIO'; throw e; });
    const r = await assessKernelLiveness({
      pool: poolWithRun(staleRun()), task: kernelTask(),
      now: () => now, hostFn: () => HOST, killFn,
    });
    expect(r.verdict).toBe('unknown');
  });
});

describe('assessKernelLiveness — fail-open 铁律', () => {
  it('DB 查询抛错 → unknown（不是 dead）', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('connection reset'); }) };
    const r = await assessKernelLiveness({ pool, task: kernelTask() });
    expect(r.verdict).toBe('unknown');
    expect(r.reason).toContain('run_query_error');
  });

  it('查不到 run 行 → unknown（不是 dead）', async () => {
    const r = await assessKernelLiveness({ pool: poolWithRun(null), task: kernelTask() });
    expect(r.verdict).toBe('unknown');
    expect(r.reason).toBe('no_kernel_run');
  });

  it('hostFn 抛错 → unknown（不是 dead）', async () => {
    const now = Date.parse('2026-07-27T01:20:00Z');
    const pool = poolWithRun(runRow({
      orchestrator_heartbeat_at: new Date('2026-07-27T01:00:00Z').toISOString(),
      orchestrator_pid: 4242, orchestrator_host: HOST,
    }));
    const r = await assessKernelLiveness({
      pool, task: kernelTask(), now: () => now,
      hostFn: () => { throw new Error('no hostname'); },
      killFn: vi.fn(() => true),
    });
    expect(r.verdict).toBe('unknown');
  });

  it('调用方直接喂 run 行时不再查库（守卫热路径省一次 query）', async () => {
    const now = Date.parse('2026-07-27T01:07:30Z');
    const pool = poolWithRun(null);
    const r = await assessKernelLiveness({
      pool, task: kernelTask(), now: () => now,
      run: runRow({ orchestrator_heartbeat_at: new Date('2026-07-27T01:06:53Z').toISOString() }),
    });
    expect(r.verdict).toBe('alive');
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('latestKernelHeartbeatMs', () => {
  it('kernel 任务 → 返回心跳 epoch ms（供旧守卫与 run_events 取 max）', async () => {
    const hb = '2026-07-27T01:06:53.000Z';
    const pool = poolWithRun(runRow({ orchestrator_heartbeat_at: hb }));
    expect(await latestKernelHeartbeatMs({ pool, task: kernelTask() })).toBe(Date.parse(hb));
  });

  it('非 kernel 任务 → null 且不查库', async () => {
    const pool = poolWithRun(runRow());
    expect(await latestKernelHeartbeatMs({ pool, task: { id: TASK_ID, payload: {} } })).toBe(null);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('查询抛错 → null（不抛给调用方）', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('db down'); }) };
    expect(await latestKernelHeartbeatMs({ pool, task: kernelTask() })).toBe(null);
  });
});
