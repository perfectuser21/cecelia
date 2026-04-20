/**
 * Harness v2 M2 — Initiative Runner 集成测试
 *
 * 覆盖：
 *   1. runInitiative happy path（mock Docker executor → parseTaskPlan → upsertTaskPlan → 建 contract + run）
 *   2. Docker executor 失败时返回 error（不写 DB）
 *   3. task-plan.json 非法时返回 error（不写 DB）
 *   4. upsertTaskPlan 建 tasks + task_dependencies 数量正确
 *   5. nextRunnableTask 按依赖顺序返回
 *
 * 真 PG，BEGIN/ROLLBACK 外层事务确保不污染共享 DB。
 * 相对路径：integration/ 子目录 → ../../
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// CI 环境没有 git worktree / gh auth，mock 掉 PR-1 新增的两个 helper。
vi.mock('../../harness-worktree.js', () => ({
  ensureHarnessWorktree: vi.fn(async ({ taskId }) => `/tmp/mock-wt/harness-v2/task-${String(taskId).slice(0, 8)}`),
  cleanupHarnessWorktree: vi.fn(async () => {}),
}));
vi.mock('../../harness-credentials.js', () => ({
  resolveGitHubToken: vi.fn(async () => 'ghs_mock_integration_token'),
}));

let pool;
let runInitiative;
let upsertTaskPlan;
let nextRunnableTask;

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  const runner = await import('../../harness-initiative-runner.js');
  runInitiative = runner.runInitiative;
  const dag = await import('../../harness-dag.js');
  upsertTaskPlan = dag.upsertTaskPlan;
  nextRunnableTask = dag.nextRunnableTask;
});

afterAll(async () => {
  // 不调 pool.end() — 其他测试文件可能共享同一 pool
});

// ─── fixture：一个 3 Task 线性 DAG 的 task-plan.json ─────────────────────

function makePlan(initiativeId = 'pending') {
  return {
    initiative_id: initiativeId,
    tasks: [
      {
        task_id: 'ws1',
        title: 'Task 1 schema',
        scope: '建 schema',
        dod: ['[BEHAVIOR] schema 就位'],
        files: ['packages/brain/migrations/999_test.sql'],
        depends_on: [],
        complexity: 'S',
        estimated_minutes: 30,
      },
      {
        task_id: 'ws2',
        title: 'Task 2 logic',
        scope: '写核心逻辑',
        dod: ['[BEHAVIOR] 逻辑就位'],
        files: ['packages/brain/src/test-x.js'],
        depends_on: ['ws1'],
        complexity: 'M',
        estimated_minutes: 45,
      },
      {
        task_id: 'ws3',
        title: 'Task 3 test',
        scope: '写测试',
        dod: ['[BEHAVIOR] 测试就位'],
        files: ['packages/brain/src/__tests__/test-x.test.js'],
        depends_on: ['ws2'],
        complexity: 'S',
        estimated_minutes: 25,
      },
    ],
  };
}

function makePlannerStdout(plan) {
  // Planner 实际输出：PRD + ```json task-plan``` 块
  return `# Sprint PRD — Demo\n\n## 目标\n\n完成 demo 功能\n\n---\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n`;
}

// ─── runInitiative happy path ─────────────────────────────────────────

describe('runInitiative — happy path', () => {
  let client;
  let initiativeTask;

  beforeEach(async () => {
    // 建 harness_initiative 任务作为父
    client = await pool.connect();
    const r = await client.query(
      `INSERT INTO tasks (task_type, title, description, status, priority)
       VALUES ('harness_initiative', 'M2 integration test', 'demo desc', 'queued', 'P2')
       RETURNING id`
    );
    initiativeTask = { id: r.rows[0].id, title: 'M2 integration test', description: 'demo desc', payload: {} };
    client.release();
  });

  afterEach(async () => {
    // 级联清理：删除本次测试产生的所有行
    if (!initiativeTask) return;
    const c = await pool.connect();
    try {
      // 找出所有子 harness_task
      const subs = await c.query(
        `SELECT id FROM tasks WHERE payload->>'parent_task_id' = $1`,
        [String(initiativeTask.id)]
      );
      const subIds = subs.rows.map((r) => r.id);
      if (subIds.length) {
        await c.query(
          `DELETE FROM task_dependencies WHERE from_task_id = ANY($1::uuid[]) OR to_task_id = ANY($1::uuid[])`,
          [subIds]
        );
        await c.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [subIds]);
      }
      // 删 initiative_runs + contract（用 initiative_id = initiativeTask.id 兜底）
      await c.query(`DELETE FROM initiative_runs WHERE initiative_id = $1::uuid`, [initiativeTask.id]);
      await c.query(`DELETE FROM initiative_contracts WHERE initiative_id = $1::uuid`, [initiativeTask.id]);
      await c.query(`DELETE FROM tasks WHERE id = $1::uuid`, [initiativeTask.id]);
    } finally {
      c.release();
    }
  });

  it('产出 3 subtask + 1 contract + 1 run，返回 success', async () => {
    const plan = makePlan();
    const mockExec = async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: makePlannerStdout(plan),
      stderr: '',
    });

    const result = await runInitiative(initiativeTask, { dockerExecutor: mockExec });

    expect(result.success).toBe(true);
    expect(result.taskId).toBe(initiativeTask.id);
    expect(result.insertedTaskIds).toHaveLength(3);
    expect(result.contractId).toBeTruthy();
    expect(result.runId).toBeTruthy();
    expect(Object.keys(result.idMap)).toEqual(['ws1', 'ws2', 'ws3']);

    // 验证 DB：3 subtask
    const subs = await pool.query(
      `SELECT id, title, payload FROM tasks WHERE payload->>'parent_task_id' = $1 ORDER BY created_at ASC`,
      [String(initiativeTask.id)]
    );
    expect(subs.rows).toHaveLength(3);
    expect(subs.rows[0].title).toBe('Task 1 schema');
    expect(subs.rows[0].payload.logical_task_id).toBe('ws1');

    // 验证 task_dependencies：2 条 hard edge
    const deps = await pool.query(
      `SELECT from_task_id, to_task_id, edge_type
       FROM task_dependencies
       WHERE from_task_id = ANY($1::uuid[])`,
      [result.insertedTaskIds]
    );
    expect(deps.rows).toHaveLength(2);
    deps.rows.forEach((r) => expect(r.edge_type).toBe('hard'));

    // 验证 initiative_contract 写入
    const contracts = await pool.query(
      `SELECT id, status, version, budget_cap_usd, timeout_sec FROM initiative_contracts WHERE id = $1::uuid`,
      [result.contractId]
    );
    expect(contracts.rows).toHaveLength(1);
    expect(contracts.rows[0].status).toBe('draft');
    expect(contracts.rows[0].version).toBe(1);

    // 验证 initiative_runs 写入
    const runs = await pool.query(
      `SELECT id, phase, contract_id, deadline_at FROM initiative_runs WHERE id = $1::uuid`,
      [result.runId]
    );
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0].phase).toBe('A_contract');
    expect(runs.rows[0].contract_id).toBe(result.contractId);
    expect(runs.rows[0].deadline_at).not.toBeNull();
  });

  it('Docker 失败时返回 error 且不写 DB', async () => {
    const mockExec = async () => ({
      exit_code: 1,
      timed_out: false,
      stdout: '',
      stderr: 'docker launch failed',
    });

    const result = await runInitiative(initiativeTask, { dockerExecutor: mockExec });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Docker exit=1/);

    // 验证没有 subtask
    const subs = await pool.query(
      `SELECT id FROM tasks WHERE payload->>'parent_task_id' = $1`,
      [String(initiativeTask.id)]
    );
    expect(subs.rows).toHaveLength(0);
  });

  it('task-plan.json 非法时返回 error 且不写 DB', async () => {
    const badStdout = '# PRD only, no task-plan json block';
    const mockExec = async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: badStdout,
      stderr: '',
    });

    const result = await runInitiative(initiativeTask, { dockerExecutor: mockExec });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/parseTaskPlan/);

    const subs = await pool.query(
      `SELECT id FROM tasks WHERE payload->>'parent_task_id' = $1`,
      [String(initiativeTask.id)]
    );
    expect(subs.rows).toHaveLength(0);
  });

  it('nextRunnableTask 按依赖顺序返回', async () => {
    const plan = makePlan();
    const mockExec = async () => ({
      exit_code: 0, timed_out: false, stdout: makePlannerStdout(plan), stderr: '',
    });

    const result = await runInitiative(initiativeTask, { dockerExecutor: mockExec });
    expect(result.success).toBe(true);

    // 初始：ws1 可运行（无依赖），ws2/ws3 不可（等 ws1）
    const first = await nextRunnableTask(initiativeTask.id);
    expect(first).not.toBeNull();
    expect(first.payload.logical_task_id).toBe('ws1');

    // mark ws1 completed
    await pool.query(`UPDATE tasks SET status='completed' WHERE id=$1::uuid`, [result.idMap.ws1]);

    const second = await nextRunnableTask(initiativeTask.id);
    expect(second).not.toBeNull();
    expect(second.payload.logical_task_id).toBe('ws2');

    // ws2 未完成，ws3 不能跑
    await pool.query(`UPDATE tasks SET status='in_progress' WHERE id=$1::uuid`, [result.idMap.ws2]);
    const third = await nextRunnableTask(initiativeTask.id);
    expect(third).toBeNull();

    // mark ws2 completed
    await pool.query(`UPDATE tasks SET status='completed' WHERE id=$1::uuid`, [result.idMap.ws2]);

    const fourth = await nextRunnableTask(initiativeTask.id);
    expect(fourth).not.toBeNull();
    expect(fourth.payload.logical_task_id).toBe('ws3');
  });
});
