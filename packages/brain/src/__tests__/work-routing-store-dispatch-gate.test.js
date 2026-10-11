/**
 * createRoutedTask 建单闸 + 借壳类型归一（派发总闸 F，任务 0a70684f）。
 *
 * 回归：10-10 每日备份 a55c7664（trigger_backup）、c8fab3c8（data 借壳编码 workflow 漏写 headed_manual）
 * 建单成功后进队无人领、静默卡死。现在：无执行者的 queued 单建单即拒（事务回滚，不 INSERT）；
 * 老形状的工厂执行单 / 编码 workflow 单建出来就是独立新类型。
 */
import { describe, it, expect, vi } from 'vitest';
import { createRoutedTask } from '../work-routing-store.js';

function makePool() {
  const query = vi.fn(async (sql) => {
    if (/INSERT INTO tasks/.test(sql)) {
      return { rows: [{ id: 'task-1', title: 'T', status: 'queued', payload: {} }], rowCount: 1 };
    }
    if (/INSERT INTO work_routing_receipts/.test(sql)) return { rows: [{ id: 'receipt-1' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { query };
}

function insertedValue(pool, column) {
  const call = pool.query.mock.calls.find(([sql]) => /INSERT INTO tasks/.test(sql));
  expect(call, '未发生 INSERT INTO tasks').toBeTruthy();
  const [sql, params] = call;
  const cols = sql.match(/INSERT INTO tasks \(([\s\S]*?)\) VALUES/)[1].split(',').map((c) => c.trim()).filter(Boolean);
  return params[cols.indexOf(column)];
}

const req = (over = {}) => ({
  source: 'scheduler',
  source_id: `src-${Math.random().toString(36).slice(2)}`,
  title: 't',
  description: 'd',
  requested_task_type: 'trigger_backup',
  mutation_intent: 'none',
  declared_domain: 'operations',
  metadata: {},
  task: { priority: 'P2' },
  ...over,
});

describe('createRoutedTask：无执行者的 queued 单建单即拒', () => {
  it('trigger_backup 以 queued 建 → 抛 no_executor_for_task_type，ROLLBACK，不 INSERT', async () => {
    const pool = makePool();
    let err;
    try { await createRoutedTask(pool, req()); } catch (e) { err = e; }
    expect(err?.code).toBe('no_executor_for_task_type');
    expect(err.task_type).toBe('trigger_backup');
    expect(pool.query.mock.calls.some(([sql]) => /INSERT INTO tasks/.test(sql))).toBe(false);
    expect(pool.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  });

  it('workflow_run 以 in_progress 建（外部起跑的账本镜像）照常入账', async () => {
    const pool = makePool();
    await createRoutedTask(pool, req({ requested_task_type: 'workflow_run', task: { priority: 'P2', status: 'in_progress' } }));
    expect(insertedValue(pool, 'task_type')).toBe('workflow_run');
  });

  it('带 headed_manual 的有头单不拦', async () => {
    const pool = makePool();
    await createRoutedTask(pool, req({ metadata: { headed_manual: 'true' } }));
    expect(insertedValue(pool, 'task_type')).toBe('trigger_backup');
  });

  it('有执行者的类型照常建（research → 西安 bridge）', async () => {
    const pool = makePool();
    await createRoutedTask(pool, req({ requested_task_type: 'research', declared_domain: 'research' }));
    expect(insertedValue(pool, 'task_type')).toBe('research');
  });
});

describe('createRoutedTask：借壳老形状归一成独立新类型', () => {
  it('research + payload.factory_dispatch=true → skill_factory_run（kind=agent）', async () => {
    const pool = makePool();
    await createRoutedTask(pool, req({
      requested_task_type: 'research', declared_domain: 'research', metadata: { factory_dispatch: true, factory: { stage: '3' } },
    }));
    expect(insertedValue(pool, 'task_type')).toBe('skill_factory_run');
    expect(insertedValue(pool, 'kind')).toBe('agent');
  });

  it('data + payload.coding_workflow=true（c8fab3c8 形状，漏 headed_manual）→ coding_workflow（kind=workflow）', async () => {
    const pool = makePool();
    await createRoutedTask(pool, req({
      requested_task_type: 'data', mutation_intent: 'read_only', declared_domain: undefined, metadata: { coding_workflow: true },
    }));
    expect(insertedValue(pool, 'task_type')).toBe('coding_workflow');
    expect(insertedValue(pool, 'kind')).toBe('workflow');
  });
});
