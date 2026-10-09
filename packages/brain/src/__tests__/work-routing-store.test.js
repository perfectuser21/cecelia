/**
 * work-routing-store.test.js —— createRoutedTask 是仓内唯一建单路径（INSERT INTO tasks）。
 * 本文件钉住 tasks.kind 真列的写入合同（决策 df67a9d6 / e073bdc2，任务 94465721）：
 *   ① 调用方不给 kind → 按 canonical_task_type 从注册表派生
 *   ② 调用方给合法 kind → 原样写入（Jev/人工判定优先于类型缺省）
 *   ③ 调用方给非法 kind → 抛 code=invalid_task_kind，且根本不 INSERT
 *
 * 不 mock work-router：走真实路由，只 mock pg 池，从 INSERT 的列清单里定位 kind 的参数位，
 * 不靠数下标（列清单以后再加列，下标断言会静默漂）。
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

/** 从 INSERT SQL 的列清单里找某列的参数值。 */
function insertedValue(pool, column) {
  const call = pool.query.mock.calls.find(([sql]) => /INSERT INTO tasks/.test(sql));
  expect(call, '未发生 INSERT INTO tasks').toBeTruthy();
  const [sql, params] = call;
  const cols = sql.match(/INSERT INTO tasks \(([\s\S]*?)\) VALUES/)[1]
    .split(',').map((c) => c.trim()).filter(Boolean);
  const idx = cols.indexOf(column);
  expect(idx, `INSERT 列清单里没有 ${column}：${cols.join(',')}`).toBeGreaterThanOrEqual(0);
  return params[idx];
}

const nonCoding = (over = {}) => ({
  source: 'api',
  source_id: `src-${Math.random().toString(36).slice(2)}`,
  title: '跑一轮周报工作流',
  description: 'd',
  requested_task_type: 'workflow_run',
  mutation_intent: 'none',
  declared_domain: 'operations',
  metadata: {},
  task: { priority: 'P2' },
  ...over,
});

describe('createRoutedTask 写 tasks.kind', () => {
  it('不传 kind → 按 canonical_task_type 派生（workflow_run → workflow；research → agent）', async () => {
    const pool = makePool();
    await createRoutedTask(pool, nonCoding());
    expect(insertedValue(pool, 'kind')).toBe('workflow');

    const pool2 = makePool();
    await createRoutedTask(pool2, nonCoding({ requested_task_type: 'research', declared_domain: 'research' }));
    expect(insertedValue(pool2, 'kind')).toBe('agent');
  });

  it('传合法 kind → 原样写入，压过类型缺省', async () => {
    const pool = makePool();
    await createRoutedTask(pool, nonCoding({ task: { priority: 'P2', kind: 'agent' } }));
    expect(insertedValue(pool, 'kind')).toBe('agent');
  });

  it('传非法 kind → 抛 invalid_task_kind，事务回滚，不 INSERT', async () => {
    const pool = makePool();
    let err;
    try {
      await createRoutedTask(pool, nonCoding({ task: { priority: 'P2', kind: 'script' } }));
    } catch (e) { err = e; }
    expect(err?.code).toBe('invalid_task_kind');
    expect(pool.query.mock.calls.some(([sql]) => /INSERT INTO tasks/.test(sql))).toBe(false);
    expect(pool.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  });
});
