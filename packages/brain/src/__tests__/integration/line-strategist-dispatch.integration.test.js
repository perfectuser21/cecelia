/**
 * line-strategist-dispatch Integration Test（真实 PostgreSQL）
 *
 * 背景：dispatchStrategistDecisions() 的单测（line-strategist-dispatch.test.js）
 * 全程 mock pool.query，从未真实执行过 INSERT INTO tasks(...task_type='strategist_decision'...)。
 * tasks_task_type_check 约束从未登记 strategist_decision，导致该 INSERT 在生产环境
 * 每次都被库拒绝（自上线以来零成功）。mock 测试无法暴露这类约束层 bug，必须用真实 DB 验证。
 *
 * 运行环境：CI brain-unit job（含真实 PostgreSQL 服务），不 mock db.js。
 */

import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { dispatchStrategistDecisions } from '../../line-strategist-dispatch.js';
import { cleanupRoutedTasks } from '../helpers/routed-task-cleanup.js';

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

const insertedTaskIds = [];

describe('dispatchStrategistDecisions Integration Test（真实 PostgreSQL）', () => {
  afterAll(async () => {
    await cleanupRoutedTasks(testPool, insertedTaskIds);
    await testPool.end();
  });

  it('tasks_task_type_check 仍登记 strategist_decision（真实 INSERT 不被约束拒绝）', async () => {
    const row = await testPool.query(
      `INSERT INTO tasks (title, task_type, priority, status, payload, trigger_source)
       VALUES ('[TEST-line-strategist-dispatch] constraint', 'strategist_decision', 'P2', 'completed', '{}'::jsonb, 'test')
       RETURNING id, task_type`,
    );
    insertedTaskIds.push(row.rows[0].id);
    expect(row.rows[0].task_type).toBe('strategist_decision');
  });

  // 派发总闸 F（任务 0a70684f）：strategist_decision 无头无执行者（location=us 落已退役 Claude 桥接），
  // 以 queued 建单被 no_executor_for_task_type 拒；派发器按非致命失败计数，源任务照常标记不死循环重试。
  it('无执行者：dispatchStrategistDecisions 建单被拒计 failed、不落 queued 单，源任务仍标记已处理', async () => {
    const journeyId = `test-journey-${Date.now()}`;
    const sourceTask = await testPool.query(
      `INSERT INTO tasks (title, description, task_type, priority, status, payload, trigger_source)
       VALUES ($1, $2, 'dev', 'P2', 'completed', $3, 'test')
       RETURNING id`,
      ['[TEST-line-strategist-dispatch] source task', '集成测试用源任务', JSON.stringify({ journey_id: journeyId })],
    );
    insertedTaskIds.push(sourceTask.rows[0].id);

    const result = await dispatchStrategistDecisions(testPool, { windowMinutes: 10 });
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const created = await testPool.query(
      `SELECT id FROM tasks WHERE task_type = 'strategist_decision' AND payload->>'journey_id' = $1`,
      [journeyId],
    );
    expect(created.rows.length).toBe(0);

    const sourceAfter = await testPool.query(
      `SELECT payload->'strategist_dispatched' AS dispatched FROM tasks WHERE id = $1`,
      [sourceTask.rows[0].id],
    );
    expect(sourceAfter.rows[0].dispatched).toBe(true);
  });
});
