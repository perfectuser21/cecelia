/** 真实派发CAS；仅私有PG，禁止dispatcher/执行器/网络广播进入本测试。 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect, it, vi } from 'vitest';
import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';

const boundary = vi.hoisted(() => ({ current: null, broadcasts: [] }));
vi.mock('../../db.js', () => ({ default: {
  query: (...args) => {
    const client = boundary.current?.getStore();
    if (!client) throw new Error('派发CAS必须在本人事务上下文内');
    return client.query(...args);
  },
} }));
vi.mock('../../task-updater.js', () => ({ broadcastTaskState: vi.fn(async id => {
  boundary.broadcasts.push({ id, pid: boundary.current.getStore().processID });
}) }));
// 只隔离未调用的建单依赖；真实authoring guard、terminal predicate及UPDATE保持真身。
vi.mock('../../work-routing-store.js', () => ({ createRoutedTask: () => { throw new Error('禁止建执行任务'); } }));
vi.mock('../../domain-detector.js', () => ({ detectDomain: () => { throw new Error('禁止进入领域路由'); } }));
vi.mock('../../role-registry.js', () => ({ getDomainRole: () => { throw new Error('禁止读取角色配置'); } }));

it('两个实际updateTask事务争抢同一queued行：真实锁等待后仅一胜者、一次广播及持久化状态', async () => {
  const config = privatePgConfig(); // 缺明确owned scratch身份时立即拒绝，不能默认连本机库。
  const observer = new pg.Client(config), first = new pg.Client(config), second = new pg.Client(config);
  const id = randomUUID();
  let inserted = false, contender;
  let observerConnected = false, firstConnected = false, secondConnected = false;
  boundary.current = new AsyncLocalStorage();
  boundary.broadcasts = [];
  try {
    await observer.connect();
    observerConnected = true;
    await verifyPrivatePg(observer);
    await observer.query(`INSERT INTO tasks(id,title,status,task_type,priority,payload,result)
      VALUES($1,$2,'queued','research','P2','{}','{}')`, [id, `dispatch-cas-${id}`]);
    inserted = true;
    await first.connect();
    firstConnected = true;
    await second.connect();
    secondConnected = true;
    for (const client of [first, second]) {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '5s'");
    }
    const { updateTask } = await import('../../actions.js');
    const winner = await boundary.current.run(first, () => updateTask({ task_id: id, status: 'in_progress' }));
    expect(winner.success).toBe(true);
    expect(winner.task).toMatchObject({ id, status: 'in_progress' });
    // 第一事务未提交：其它连接仍可见queued，不能用同一连接读回冒充持久化。
    expect((await observer.query('SELECT status FROM tasks WHERE id=$1', [id])).rows[0].status).toBe('queued');
    let settled = false;
    contender = boundary.current.run(second, () => updateTask({ task_id: id, status: 'in_progress' }))
      .then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    let lock;
    for (let attempt = 0; attempt < 200; attempt++) {
      const row = (await observer.query(`SELECT state,wait_event_type,wait_event
        FROM pg_stat_activity WHERE pid=$1`, [second.processID])).rows[0];
      if (row?.wait_event_type === 'Lock') { lock = row; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(lock).toMatchObject({ state: 'active', wait_event_type: 'Lock', wait_event: 'transactionid' });
    expect(settled).toBe(false);
    expect(boundary.broadcasts).toEqual([{ id, pid: first.processID }]);
    await first.query('COMMIT');
    const loser = await contender;
    expect(loser.error).toBeUndefined();
    expect(loser.value).toEqual({ success: false, error: 'Task not found or already dispatched' });
    await second.query('COMMIT');
    expect(boundary.broadcasts).toEqual([{ id, pid: first.processID }]);
    const rows = (await observer.query('SELECT id,status,started_at FROM tasks WHERE id=$1', [id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, status: 'in_progress' });
    expect(rows[0].started_at).toBeInstanceOf(Date);
  } finally {
    // 先释放胜者锁再等竞争者，所有失败路径亦有界回收；不吞测试主体断言。
    if (firstConnected) await first.query('ROLLBACK').catch(() => {});
    if (contender) await contender;
    if (secondConnected) await second.query('ROLLBACK').catch(() => {});
    if (firstConnected) await first.end();
    if (secondConnected) await second.end();
    if (inserted) {
      await observer.query('DELETE FROM tasks WHERE id=$1', [id]);
      expect((await observer.query('SELECT id FROM tasks WHERE id=$1', [id])).rows).toEqual([]);
    }
    if (observerConnected) await observer.end();
    boundary.current.disable();
  }
}, 15000);
