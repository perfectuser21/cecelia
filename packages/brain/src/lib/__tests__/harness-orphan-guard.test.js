import { describe, it, expect, vi } from 'vitest';
import {
  requeueOrphanTask,
  handleRelayExitConsistency,
  sweepOrphanHarnessTasks,
  WAIT_SUICIDE_PATTERN,
} from '../harness-orphan-guard.js';

function mockPool(taskRow) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      const s = String(sql);
      if (s.includes('SELECT') && s.includes('FROM tasks')) {
        return { rows: taskRow ? [taskRow] : [] };
      }
      if (s.includes('initiative_run_events')) return { rows: [{ last_hb: 0 }] };
      return { rows: [] };
    }),
  };
}

describe('WAIT_SUICIDE_PATTERN', () => {
  it('命中"等 Monitor 通知"族措辞,不误伤正常结语', () => {
    expect(WAIT_SUICIDE_PATTERN.test('6 个 checks 还在跑（无失败），等 Monitor 通知。')).toBe(true);
    expect(WAIT_SUICIDE_PATTERN.test('waiting for Monitor notification before proceeding')).toBe(true);
    expect(WAIT_SUICIDE_PATTERN.test('等待通知到达后继续')).toBe(true);
    expect(WAIT_SUICIDE_PATTERN.test('全部完成,PR 已合并')).toBe(false);
  });
});

describe('requeueOrphanTask', () => {
  const task = { id: 'aaaabbbb-0000-0000-0000-000000000000', payload: {} };

  it('计数未达上限 → 打回 queued 并清 claim,计数+1', async () => {
    const pool = mockPool();
    const r = await requeueOrphanTask(pool, task, 'callback-exit-nonterminal');
    expect(r.action).toBe('requeued');
    const upd = pool.calls.find((c) => c.sql.includes('UPDATE tasks'));
    expect(upd.sql).toContain("status = 'queued'");
    expect(upd.sql).toContain('claimed_by = NULL');
    expect(upd.sql).toContain('orphan_requeue_count');
    expect(upd.sql).toContain("status = 'in_progress'"); // 条件守卫:只动 in_progress
  });

  it('计数已达上限(3) → 转 failed 终态,防死循环', async () => {
    const pool = mockPool();
    const capped = { ...task, payload: { orphan_requeue_count: 3 } };
    const r = await requeueOrphanTask(pool, capped, 'x');
    expect(r.action).toBe('failed');
    const upd = pool.calls.find((c) => c.sql.includes('UPDATE tasks'));
    expect(upd.sql).toContain("status = 'failed'");
  });
});

describe('handleRelayExitConsistency', () => {
  const shortId = 'aaaabbbb';
  const containerId = `cecelia-relay-${shortId}-deadbeef`;
  const taskRow = {
    id: 'aaaabbbb-0000-0000-0000-000000000000',
    status: 'in_progress',
    task_type: 'harness_initiative',
    payload: {},
  };

  it('任务已终态 → 不动', async () => {
    const pool = mockPool({ ...taskRow, status: 'completed' });
    const execFn = vi.fn(() => '');
    const r = await handleRelayExitConsistency({ pool, execFn, containerId, exitCode: 0, resultText: '' });
    expect(r.action).toBe('noop');
  });

  it('任务 in_progress 且同 initiative 还有别的活容器 → 不动(防双跑)', async () => {
    const pool = mockPool(taskRow);
    const execFn = vi.fn(() => `cecelia-relay-${shortId}-alive1\n`);
    const r = await handleRelayExitConsistency({ pool, execFn, containerId, exitCode: 1, resultText: '' });
    expect(r.action).toBe('noop');
    expect(execFn).toHaveBeenCalled();
  });

  it('任务 in_progress 且无活容器 → requeue', async () => {
    const pool = mockPool(taskRow);
    const execFn = vi.fn(() => `${containerId}\n`); // 只有自己(正在退出的这个)
    const r = await handleRelayExitConsistency({ pool, execFn, containerId, exitCode: 1, resultText: '' });
    expect(r.action).toBe('requeued');
  });

  it('等待措辞自杀 → requeue 且标记 suicide 计数', async () => {
    const pool = mockPool(taskRow);
    const execFn = vi.fn(() => '');
    const r = await handleRelayExitConsistency({
      pool, execFn, containerId, exitCode: 0,
      resultText: '6 个 checks 还在跑（无失败），等 Monitor 通知。',
    });
    expect(r.action).toBe('requeued');
    expect(r.suicide).toBe(true);
    const upd = pool.calls.find((c) => c.sql.includes('UPDATE tasks'));
    expect(JSON.stringify(upd.params)).toContain('wait_suicide_count');
  });

  it('docker 查询抛错 → fail-open 不动(宁漏不误杀)', async () => {
    const pool = mockPool(taskRow);
    const execFn = vi.fn(() => { throw new Error('docker down'); });
    const r = await handleRelayExitConsistency({ pool, execFn, containerId, exitCode: 1, resultText: '' });
    expect(r.action).toBe('noop');
  });
});

describe('sweepOrphanHarnessTasks', () => {
  it('无活容器且无新鲜心跳的 in_progress harness 任务 → requeue', async () => {
    const pool = mockPool();
    pool.query = vi.fn(async (sql) => {
      const s = String(sql);
      pool.calls.push({ sql: s });
      if (s.includes('SELECT') && s.includes("task_type LIKE 'harness%'")) {
        return { rows: [{ id: 'ccccdddd-0000-0000-0000-000000000000', title: 't', payload: {}, status: 'in_progress' }] };
      }
      if (s.includes('initiative_run_events')) return { rows: [{ last_hb: 0 }] };
      return { rows: [] };
    });
    const execFn = vi.fn(() => '');
    const r = await sweepOrphanHarnessTasks({ pool, execFn, idleMinutes: 15 });
    expect(r.requeued).toBe(1);
    expect(pool.calls.some((c) => c.sql.includes("status = 'queued'"))).toBe(true);
  });

  it('有活容器 → 跳过', async () => {
    const pool = mockPool();
    pool.query = vi.fn(async (sql) => {
      const s = String(sql);
      if (s.includes("task_type LIKE 'harness%'")) {
        return { rows: [{ id: 'ccccdddd-0000-0000-0000-000000000000', title: 't', payload: {}, status: 'in_progress' }] };
      }
      if (s.includes('initiative_run_events')) return { rows: [{ last_hb: 0 }] };
      return { rows: [] };
    });
    const execFn = vi.fn(() => 'cecelia-relay-ccccdddd-live1\n');
    const r = await sweepOrphanHarnessTasks({ pool, execFn, idleMinutes: 15 });
    expect(r.requeued).toBe(0);
  });
});

// ─── 终审必修回归锁:收权分界(generator_done 归 relay-watchdog,闸不抢) ────────
describe('收权分界:generator_done 后闸让位 watchdog', () => {
  const shortId = 'aaaabbbb';
  const containerId = `cecelia-relay-${shortId}-deadbeef`;

  it('callback 闸:任务 generator_done=true → noop(PR 态收口归 watchdog)', async () => {
    const pool = mockPool({
      id: 'aaaabbbb-0000-0000-0000-000000000000', status: 'in_progress',
      task_type: 'harness_initiative', payload: { generator_done: true },
    });
    const execFn = vi.fn(() => '');
    const r = await handleRelayExitConsistency({ pool, execFn, containerId, exitCode: 0, resultText: '等 Monitor 通知' });
    expect(r.action).toBe('noop');
  });

  it('sweep:SELECT 排除 generator_done 任务', async () => {
    const pool = mockPool();
    pool.query = vi.fn(async (sql) => {
      pool.calls.push({ sql: String(sql) });
      return { rows: [] };
    });
    await sweepOrphanHarnessTasks({ pool, execFn: vi.fn(() => ''), idleMinutes: 15 });
    const sel = pool.calls.find((c) => c.sql.includes("task_type LIKE 'harness%'"));
    expect(sel.sql).toContain('generator_done');
  });
});

describe('WAIT_SUICIDE_PATTERN 头号死因原句(终审 Minor1 回归锁)', () => {
  it('命中"等待 CI 结果通知"', () => {
    expect(WAIT_SUICIDE_PATTERN.test('PR 已开出,等待 CI 结果通知。')).toBe(true);
  });
});

// ─── Kernel v1 判活闸（刀2，事故 51836fb2 回归锁）────────────────────────────
// Kernel v1 执行体是 Brain 容器内的裸 Node 进程，既没有 cecelia-relay-* 容器，
// 也从不写 initiative_run_events —— 旧守卫的两个信号同时返回"死"，
// 于是活着的 controller 被 requeue 三次后烧成 failed。
describe('Kernel v1 判活闸:活着的 kernel 绝不 requeue', () => {
  const KERNEL_TASK_ID = '51836fb2-10ea-48eb-97b2-c324df32d147';

  function sweepPool(taskPayload) {
    const calls = [];
    const pool = {
      calls,
      query: vi.fn(async (sql, params) => {
        const s = String(sql);
        calls.push({ sql: s, params });
        if (s.includes("task_type LIKE 'harness%'")) {
          return {
            rows: [{
              id: KERNEL_TASK_ID, title: 'kernel run', status: 'in_progress',
              payload: taskPayload, initiative_id: KERNEL_TASK_ID,
            }],
          };
        }
        if (s.includes('initiative_run_events')) return { rows: [{ last_hb: 0 }] };
        return { rows: [] };
      }),
    };
    return pool;
  }

  const noContainers = () => '';

  it('kernel 判活=alive → 不 requeue（事故主线）', async () => {
    const pool = sweepPool({ harness_runtime: 'kernel-v1' });
    const assessKernel = vi.fn(async () => ({ verdict: 'alive', reason: 'fresh_heartbeat' }));
    const r = await sweepOrphanHarnessTasks({
      pool, execFn: vi.fn(noContainers), idleMinutes: 15, assessKernel,
    });
    expect(assessKernel).toHaveBeenCalled();
    expect(r.requeued).toBe(0);
    expect(r.failed).toBe(0);
    expect(r.kernelHeld).toBe(1);
    expect(pool.calls.some((c) => c.sql.includes("status = 'queued'"))).toBe(false);
  });

  it('kernel 无 active run → 只按 current_task_id 对账已终态 run，不 requeue', async () => {
    const pool = sweepPool({ harness_runtime: 'kernel-v1' });
    const assessKernel = vi.fn(async () => ({ verdict: 'unknown', reason: 'no_kernel_run' }));
    const reconcileKernelTerminal = vi.fn(async () => ({
      reconciled: true,
      runId: '99999999-9999-4999-8999-999999999999',
      outcome: 'failed',
    }));
    const r = await sweepOrphanHarnessTasks({
      pool,
      execFn: vi.fn(noContainers),
      idleMinutes: 15,
      assessKernel,
      reconcileKernelTerminal,
    });
    expect(r.requeued).toBe(0);
    expect(r.terminalReconciled).toBe(1);
    expect(reconcileKernelTerminal).toHaveBeenCalledWith(
      pool,
      KERNEL_TASK_ID,
      expect.any(Object),
    );
  });

  it('kernel 无 active/terminal run → 标记 unresolved，不猜测、不 requeue', async () => {
    const pool = sweepPool({ harness_runtime: 'kernel-v1' });
    const assessKernel = vi.fn(async () => ({ verdict: 'unknown', reason: 'no_kernel_run' }));
    const reconcileKernelTerminal = vi.fn(async () => ({
      reconciled: false,
      reason: 'no_task_linked_terminal_run',
    }));
    const r = await sweepOrphanHarnessTasks({
      pool,
      execFn: vi.fn(noContainers),
      idleMinutes: 15,
      assessKernel,
      reconcileKernelTerminal,
    });
    expect(r.requeued).toBe(0);
    expect(r.kernelUnresolved).toBe(1);
  });

  it('判活函数抛异常 → 仍不 requeue（fail-open）', async () => {
    const pool = sweepPool({ harness_runtime: 'kernel-v1' });
    const assessKernel = vi.fn(async () => { throw new Error('probe blew up'); });
    const r = await sweepOrphanHarnessTasks({
      pool, execFn: vi.fn(noContainers), idleMinutes: 15, assessKernel,
    });
    expect(r.requeued).toBe(0);
  });

  it('kernel 判活=dead → run/task 原子 failed，绝不退回 legacy requeue', async () => {
    const pool = sweepPool({ harness_runtime: 'kernel-v1' });
    const runId = '99999999-9999-4999-8999-999999999999';
    const assessKernel = vi.fn(async () => ({ verdict: 'dead', reason: 'pid_gone', runId }));
    const finalizeRun = vi.fn(async () => ({
      changed: true,
      outcome: 'failed',
      runId,
      taskId: KERNEL_TASK_ID,
    }));
    const r = await sweepOrphanHarnessTasks({
      pool,
      execFn: vi.fn(noContainers),
      idleMinutes: 15,
      assessKernel,
      finalizeRun,
    });
    expect(r.requeued).toBe(0);
    expect(r.failed).toBe(1);
    expect(finalizeRun).toHaveBeenCalledWith(pool, {
      runId,
      expectedTaskId: KERNEL_TASK_ID,
      outcome: 'failed',
      reason: 'kernel_orphan_dead:pid_gone',
    });
  });

  it('回归锁:旧 relay 任务（无 harness_runtime）行为一字不变 —— 判活返回 not_applicable 仍照旧 requeue', async () => {
    const pool = sweepPool({});
    const assessKernel = vi.fn(async () => ({ verdict: 'not_applicable' }));
    const r = await sweepOrphanHarnessTasks({
      pool, execFn: vi.fn(noContainers), idleMinutes: 15, assessKernel,
    });
    expect(r.requeued).toBe(1);
    expect(r.kernelHeld).toBe(0);
  });

  it('golden_path_proposal + kernel-v1 同样进入 exact reconciliation', async () => {
    const pool = sweepPool({ harness_runtime: 'kernel-v1' });
    pool.query.mockImplementation(async (sql, params) => {
      const s = String(sql);
      pool.calls.push({ sql: s, params });
      if (s.includes("task_type LIKE 'harness%'")) {
        return {
          rows: [{
            id: KERNEL_TASK_ID,
            title: 'kernel GP',
            status: 'in_progress',
            task_type: 'golden_path_proposal',
            payload: { harness_runtime: 'kernel-v1' },
            initiative_id: KERNEL_TASK_ID,
          }],
        };
      }
      return { rows: [] };
    });
    const assessKernel = vi.fn(async () => ({
      verdict: 'unknown',
      reason: 'no_kernel_run',
    }));
    const reconcileKernelTerminal = vi.fn(async () => ({
      reconciled: false,
      reason: 'no_task_linked_terminal_run',
    }));

    const r = await sweepOrphanHarnessTasks({
      pool,
      execFn: vi.fn(noContainers),
      idleMinutes: 15,
      assessKernel,
      reconcileKernelTerminal,
    });

    const select = pool.calls.find(({ sql }) => sql.includes('FROM tasks'));
    expect(select.sql).toContain("task_type = 'golden_path_proposal'");
    expect(assessKernel).toHaveBeenCalled();
    expect(r.kernelUnresolved).toBe(1);
    expect(r.requeued).toBe(0);
  });

  it('callback 退出闸:kernel 活着 → noop，不 requeue', async () => {
    const pool = mockPool({
      id: KERNEL_TASK_ID, status: 'in_progress', task_type: 'harness_initiative',
      payload: { harness_runtime: 'kernel-v1' },
    });
    const assessKernel = vi.fn(async () => ({ verdict: 'alive', reason: 'fresh_heartbeat' }));
    const r = await handleRelayExitConsistency({
      pool, execFn: vi.fn(noContainers), assessKernel,
      containerId: `cecelia-relay-${KERNEL_TASK_ID.slice(0, 8)}-x`, exitCode: 1, resultText: '',
    });
    expect(r.action).toBe('noop');
    expect(pool.calls.some((c) => c.sql.includes("status = 'queued'"))).toBe(false);
  });

  it('callback 退出闸:kernel dead → 原子 failed，不 requeue', async () => {
    const runId = '99999999-9999-4999-8999-999999999999';
    const pool = mockPool({
      id: KERNEL_TASK_ID, status: 'in_progress', task_type: 'harness_initiative',
      payload: { harness_runtime: 'kernel-v1' },
    });
    const assessKernel = vi.fn(async () => ({ verdict: 'dead', reason: 'pid_gone', runId }));
    const finalizeRun = vi.fn(async () => ({
      changed: true,
      outcome: 'failed',
      runId,
      taskId: KERNEL_TASK_ID,
    }));
    const r = await handleRelayExitConsistency({
      pool,
      execFn: vi.fn(noContainers),
      assessKernel,
      finalizeRun,
      containerId: `cecelia-relay-${KERNEL_TASK_ID.slice(0, 8)}-x`,
      exitCode: 1,
      resultText: '',
    });
    expect(r.action).toBe('failed');
    expect(finalizeRun).toHaveBeenCalled();
    expect(pool.calls.some((c) => c.sql.includes("status = 'queued'"))).toBe(false);
  });
});

describe('心跳取 max:kernel 心跳与 initiative_run_events 任一新鲜即视为活', () => {
  const KERNEL_TASK_ID = '51836fb2-10ea-48eb-97b2-c324df32d147';

  it('run_events 心跳为 0 但 kernel 心跳新鲜 → 不 requeue', async () => {
    const calls = [];
    const pool = {
      calls,
      query: vi.fn(async (sql) => {
        const s = String(sql);
        calls.push({ sql: s });
        if (s.includes("task_type LIKE 'harness%'")) {
          return {
            rows: [{
              id: KERNEL_TASK_ID, title: 'k', status: 'in_progress',
              payload: { harness_runtime: 'kernel-v1' }, initiative_id: KERNEL_TASK_ID,
            }],
          };
        }
        if (s.includes('initiative_run_events')) return { rows: [{ last_hb: 0 }] };
        if (s.includes('FROM initiative_runs')) {
          return { rows: [{ orchestrator_heartbeat_at: new Date().toISOString(), orchestrator_pid: null, orchestrator_host: null }] };
        }
        return { rows: [] };
      }),
    };
    // 不注入 assessKernel —— 走真实判活模块 + 真实 SQL 路径
    const r = await sweepOrphanHarnessTasks({ pool, execFn: vi.fn(() => ''), idleMinutes: 15 });
    expect(r.requeued).toBe(0);
    expect(calls.some((c) => c.sql.includes('FROM initiative_runs'))).toBe(true);
  });
});
