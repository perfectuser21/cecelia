import { describe, it, expect, vi } from 'vitest';
import {
  handleRelayExitConsistency,
  sweepOrphanHarnessTasks,
} from '../harness-orphan-guard.js';

const KERNEL_TASK_ID = '51836fb2-10ea-48eb-97b2-c324df32d147';

function mockPool(taskRow) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      const statement = String(sql);
      if (statement.includes('SELECT') && statement.includes('FROM tasks')) {
        return { rows: taskRow ? [taskRow] : [] };
      }
      if (statement.includes('initiative_run_events')) return { rows: [{ last_hb: 0 }] };
      return { rows: [] };
    }),
  };
}

function sweepPool(taskPayload) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      const statement = String(sql);
      calls.push({ sql: statement, params });
      if (statement.includes("task_type LIKE 'harness%'")) {
        return {
          rows: [{
            id: KERNEL_TASK_ID,
            title: 'kernel run',
            status: 'in_progress',
            payload: taskPayload,
            initiative_id: KERNEL_TASK_ID,
          }],
        };
      }
      if (statement.includes('initiative_run_events')) return { rows: [{ last_hb: 0 }] };
      return { rows: [] };
    }),
  };
}

const noContainers = () => '';

describe('Kernel v1 判活闸:活着的 kernel 绝不 requeue', () => {
  it('kernel 判活=alive → 不 requeue（事故主线）', async () => {
    const pool = sweepPool({ harness_runtime: 'kernel-v1' });
    const assessKernel = vi.fn(async () => ({ verdict: 'alive', reason: 'fresh_heartbeat' }));
    const result = await sweepOrphanHarnessTasks({
      pool, execFn: vi.fn(noContainers), idleMinutes: 15, assessKernel,
    });
    expect(assessKernel).toHaveBeenCalled();
    expect(result.requeued).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.kernelHeld).toBe(1);
    expect(pool.calls.some((call) => call.sql.includes("status = 'queued'"))).toBe(false);
  });

  it('kernel 无 active run → 只按 current_task_id 对账已终态 run，不 requeue', async () => {
    const pool = sweepPool({ harness_runtime: 'kernel-v1' });
    const assessKernel = vi.fn(async () => ({ verdict: 'unknown', reason: 'no_kernel_run' }));
    const reconcileKernelTerminal = vi.fn(async () => ({
      reconciled: true,
      runId: '99999999-9999-4999-8999-999999999999',
      outcome: 'failed',
    }));
    const result = await sweepOrphanHarnessTasks({
      pool,
      execFn: vi.fn(noContainers),
      idleMinutes: 15,
      assessKernel,
      reconcileKernelTerminal,
    });
    expect(result.requeued).toBe(0);
    expect(result.terminalReconciled).toBe(1);
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
    const result = await sweepOrphanHarnessTasks({
      pool,
      execFn: vi.fn(noContainers),
      idleMinutes: 15,
      assessKernel,
      reconcileKernelTerminal,
    });
    expect(result.requeued).toBe(0);
    expect(result.kernelUnresolved).toBe(1);
  });

  it('判活函数抛异常 → 仍不 requeue（fail-open）', async () => {
    const pool = sweepPool({ harness_runtime: 'kernel-v1' });
    const assessKernel = vi.fn(async () => { throw new Error('probe blew up'); });
    const result = await sweepOrphanHarnessTasks({
      pool, execFn: vi.fn(noContainers), idleMinutes: 15, assessKernel,
    });
    expect(result.requeued).toBe(0);
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
    const result = await sweepOrphanHarnessTasks({
      pool,
      execFn: vi.fn(noContainers),
      idleMinutes: 15,
      assessKernel,
      finalizeRun,
    });
    expect(result.requeued).toBe(0);
    expect(result.failed).toBe(1);
    expect(finalizeRun).toHaveBeenCalledWith(pool, {
      runId,
      expectedTaskId: KERNEL_TASK_ID,
      outcome: 'failed',
      reason: 'kernel_orphan_dead:pid_gone',
    });
  });

  it('旧 relay 任务保持 legacy requeue 行为', async () => {
    const pool = sweepPool({});
    const assessKernel = vi.fn(async () => ({ verdict: 'not_applicable' }));
    const result = await sweepOrphanHarnessTasks({
      pool, execFn: vi.fn(noContainers), idleMinutes: 15, assessKernel,
    });
    expect(result.requeued).toBe(1);
    expect(result.kernelHeld).toBe(0);
  });

  it('golden_path_proposal + kernel-v1 同样进入 exact reconciliation', async () => {
    const pool = sweepPool({ harness_runtime: 'kernel-v1' });
    pool.query.mockImplementation(async (sql, params) => {
      const statement = String(sql);
      pool.calls.push({ sql: statement, params });
      if (statement.includes("task_type LIKE 'harness%'")) {
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

    const result = await sweepOrphanHarnessTasks({
      pool,
      execFn: vi.fn(noContainers),
      idleMinutes: 15,
      assessKernel,
      reconcileKernelTerminal,
    });

    const select = pool.calls.find(({ sql }) => sql.includes('FROM tasks'));
    expect(select.sql).toContain("task_type = 'golden_path_proposal'");
    expect(assessKernel).toHaveBeenCalled();
    expect(result.kernelUnresolved).toBe(1);
    expect(result.requeued).toBe(0);
  });

  it('callback 退出闸:kernel 活着 → noop，不 requeue', async () => {
    const pool = mockPool({
      id: KERNEL_TASK_ID,
      status: 'in_progress',
      task_type: 'harness_initiative',
      payload: { harness_runtime: 'kernel-v1' },
    });
    const assessKernel = vi.fn(async () => ({ verdict: 'alive', reason: 'fresh_heartbeat' }));
    const result = await handleRelayExitConsistency({
      pool,
      execFn: vi.fn(noContainers),
      assessKernel,
      containerId: `cecelia-relay-${KERNEL_TASK_ID.slice(0, 8)}-x`,
      exitCode: 1,
      resultText: '',
    });
    expect(result.action).toBe('noop');
    expect(pool.calls.some((call) => call.sql.includes("status = 'queued'"))).toBe(false);
  });

  it('callback 退出闸:kernel dead → 原子 failed，不 requeue', async () => {
    const runId = '99999999-9999-4999-8999-999999999999';
    const pool = mockPool({
      id: KERNEL_TASK_ID,
      status: 'in_progress',
      task_type: 'harness_initiative',
      payload: { harness_runtime: 'kernel-v1' },
    });
    const assessKernel = vi.fn(async () => ({ verdict: 'dead', reason: 'pid_gone', runId }));
    const finalizeRun = vi.fn(async () => ({
      changed: true,
      outcome: 'failed',
      runId,
      taskId: KERNEL_TASK_ID,
    }));
    const result = await handleRelayExitConsistency({
      pool,
      execFn: vi.fn(noContainers),
      assessKernel,
      finalizeRun,
      containerId: `cecelia-relay-${KERNEL_TASK_ID.slice(0, 8)}-x`,
      exitCode: 1,
      resultText: '',
    });
    expect(result.action).toBe('failed');
    expect(finalizeRun).toHaveBeenCalled();
    expect(pool.calls.some((call) => call.sql.includes("status = 'queued'"))).toBe(false);
  });
});

describe('心跳取 max:kernel 心跳与 initiative_run_events 任一新鲜即视为活', () => {
  it('run_events 心跳为 0 但 kernel 心跳新鲜 → 不 requeue', async () => {
    const calls = [];
    const pool = {
      calls,
      query: vi.fn(async (sql) => {
        const statement = String(sql);
        calls.push({ sql: statement });
        if (statement.includes("task_type LIKE 'harness%'")) {
          return {
            rows: [{
              id: KERNEL_TASK_ID,
              title: 'k',
              status: 'in_progress',
              payload: { harness_runtime: 'kernel-v1' },
              initiative_id: KERNEL_TASK_ID,
            }],
          };
        }
        if (statement.includes('initiative_run_events')) return { rows: [{ last_hb: 0 }] };
        if (statement.includes('FROM initiative_runs')) {
          return {
            rows: [{
              orchestrator_heartbeat_at: new Date().toISOString(),
              orchestrator_pid: null,
              orchestrator_host: null,
            }],
          };
        }
        return { rows: [] };
      }),
    };
    const result = await sweepOrphanHarnessTasks({
      pool,
      execFn: vi.fn(() => ''),
      idleMinutes: 15,
    });
    expect(result.requeued).toBe(0);
    expect(calls.some((call) => call.sql.includes('FROM initiative_runs'))).toBe(true);
  });
});
