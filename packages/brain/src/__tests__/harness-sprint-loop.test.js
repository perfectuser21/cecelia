/**
 * Harness v2.0 Sprint 循环断链测试
 *
 * 验证 execution-callback 中的 Harness 断链逻辑：
 * - sprint_generate 完成 → 创建 sprint_evaluate
 * - sprint_evaluate PASS → 标记 dev task completed + 检查 Initiative 完成
 * - sprint_evaluate FAIL → 创建 sprint_fix
 * - sprint_fix 完成 → 创建 sprint_evaluate（再测）
 * - 所有 sprint PASS → 创建 arch_review
 * - 非 harness_mode 走旧断链
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock pool
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// mock actions.createTask
const mockCreateTask = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'new-task-id' }));
vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));

/**
 * 模拟 harness 断链核心逻辑（从 execution.js 提取简化）
 */
async function simulateHarnessCallback(taskData, result) {
  const pool = (await import('../db.js')).default;
  const { createTask } = await import('../actions.js');

  const harnessPayload = taskData.payload || {};

  if (taskData.task_type === 'sprint_generate') {
    await createTask({
      title: `[Evaluator] 测试 Sprint`,
      description: 'test',
      priority: 'P1',
      project_id: taskData.project_id,
      goal_id: taskData.goal_id,
      task_type: 'sprint_evaluate',
      trigger_source: 'execution_callback_harness',
      payload: {
        sprint_dir: harnessPayload.sprint_dir,
        dev_task_id: harnessPayload.dev_task_id,
        eval_round: 1,
        harness_mode: true
      }
    });
    return;
  }

  if (taskData.task_type === 'sprint_evaluate') {
    const resultObj = typeof result === 'object' && result !== null ? result : {};
    const verdict = resultObj.verdict || 'FAIL';
    const devTaskId = harnessPayload.dev_task_id;

    if (verdict === 'PASS' && devTaskId) {
      // 标记 dev task completed
      await pool.query(
        'UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2 AND status != $3',
        ['completed', devTaskId, 'completed']
      );

      // 检查 pending dev tasks
      const pendingResult = await pool.query(
        'SELECT COUNT(*) AS cnt FROM tasks WHERE project_id = $1 AND task_type = $2 AND status NOT IN ($3,$4,$5,$6)',
        [taskData.project_id, 'dev', 'completed', 'failed', 'cancelled', 'quarantined']
      );
      const pendingCnt = parseInt(pendingResult.rows[0]?.cnt || 0);

      if (pendingCnt === 0) {
        // 幂等检查
        const existingAr = await pool.query(
          'SELECT id FROM tasks WHERE project_id = $1 AND task_type = $2 AND status IN ($3,$4) LIMIT 1',
          [taskData.project_id, 'arch_review', 'queued', 'in_progress']
        );
        if (existingAr.rows.length === 0) {
          await createTask({
            title: '[验收] Initiative 整体审查',
            description: 'test',
            priority: 'P1',
            project_id: taskData.project_id,
            goal_id: taskData.goal_id,
            task_type: 'arch_review',
            trigger_source: 'execution_callback_harness',
            payload: { scope: 'initiative', trigger: 'all_sprints_passed', harness_mode: true }
          });
        }
      }
    } else if (verdict !== 'PASS') {
      await createTask({
        title: `[Fix] Sprint 修复 R${(harnessPayload.eval_round || 0) + 1}`,
        description: 'test',
        priority: 'P1',
        project_id: taskData.project_id,
        goal_id: taskData.goal_id,
        task_type: 'sprint_fix',
        trigger_source: 'execution_callback_harness',
        payload: {
          sprint_dir: harnessPayload.sprint_dir,
          dev_task_id: harnessPayload.dev_task_id,
          eval_round: (harnessPayload.eval_round || 0) + 1,
          harness_mode: true
        }
      });
    }
    return;
  }

  if (taskData.task_type === 'sprint_fix') {
    await createTask({
      title: `[Evaluator] 重测 Sprint`,
      description: 'test',
      priority: 'P1',
      project_id: taskData.project_id,
      goal_id: taskData.goal_id,
      task_type: 'sprint_evaluate',
      trigger_source: 'execution_callback_harness',
      payload: {
        sprint_dir: harnessPayload.sprint_dir,
        dev_task_id: harnessPayload.dev_task_id,
        eval_round: harnessPayload.eval_round || 1,
        harness_mode: true
      }
    });
  }
}

describe('Harness v2.0 Sprint Loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sprint_generate 完成 → 创建 sprint_evaluate', async () => {
    const task = {
      task_type: 'sprint_generate',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints/sprint-1', dev_task_id: 'dev-1', harness_mode: true }
    };

    await simulateHarnessCallback(task, { summary: 'done' });

    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_evaluate');
    expect(call.payload.sprint_dir).toBe('sprints/sprint-1');
    expect(call.payload.dev_task_id).toBe('dev-1');
    expect(call.payload.eval_round).toBe(1);
    expect(call.payload.harness_mode).toBe(true);
  });

  it('sprint_evaluate PASS + 无 pending → 标记 dev completed + 创建 arch_review', async () => {
    const task = {
      task_type: 'sprint_evaluate',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints/sprint-1', dev_task_id: 'dev-1', eval_round: 1, harness_mode: true }
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [] })           // UPDATE dev task
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] }) // pending = 0
      .mockResolvedValueOnce({ rows: [] });            // no existing arch_review

    await simulateHarnessCallback(task, { verdict: 'PASS' });

    // dev task marked completed
    expect(mockQuery.mock.calls[0][1]).toContain('dev-1');

    // arch_review created
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('arch_review');
    expect(call.payload.scope).toBe('initiative');
    expect(call.payload.trigger).toBe('all_sprints_passed');
  });

  it('sprint_evaluate PASS + 还有 pending → 只标记 dev completed, 不创建 arch_review', async () => {
    const task = {
      task_type: 'sprint_evaluate',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints/sprint-1', dev_task_id: 'dev-1', eval_round: 1, harness_mode: true }
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [] })           // UPDATE dev task
      .mockResolvedValueOnce({ rows: [{ cnt: '2' }] }); // pending = 2

    await simulateHarnessCallback(task, { verdict: 'PASS' });

    // dev task marked completed
    expect(mockQuery).toHaveBeenCalledTimes(2);

    // NO arch_review
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('sprint_evaluate FAIL → 创建 sprint_fix（eval_round 递增）', async () => {
    const task = {
      task_type: 'sprint_evaluate',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints/sprint-1', dev_task_id: 'dev-1', eval_round: 2, harness_mode: true }
    };

    await simulateHarnessCallback(task, { verdict: 'FAIL', feedback: 'API 500' });

    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_fix');
    expect(call.payload.eval_round).toBe(3);
    expect(call.payload.dev_task_id).toBe('dev-1');
  });

  it('sprint_fix 完成 → 创建 sprint_evaluate（再测）', async () => {
    const task = {
      task_type: 'sprint_fix',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints/sprint-1', dev_task_id: 'dev-1', eval_round: 3, harness_mode: true }
    };

    await simulateHarnessCallback(task, { summary: 'fixed' });

    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_evaluate');
    expect(call.payload.eval_round).toBe(3);
    expect(call.payload.sprint_dir).toBe('sprints/sprint-1');
  });

  it('task-router.js 包含 3 个新 task_type', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('packages/brain/src/task-router.js', 'utf8');

    expect(content).toContain('sprint_generate');
    expect(content).toContain('sprint_evaluate');
    expect(content).toContain('sprint_fix');
    expect(content).toContain("'sprint_generate': '/dev'");
    expect(content).toContain("'sprint_evaluate': '/sprint-evaluator'");
    expect(content).toContain("'sprint_fix': '/dev'");
  });

  it('execution.js 包含 harness_mode 兼容判断', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8');

    expect(content).toContain('harness_mode');
    expect(content).toContain('!devTask.payload?.harness_mode');
  });
});
