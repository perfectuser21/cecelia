/**
 * callback-crystallize-pipeline.test.js
 *
 * DoD: crystallize_forge 回调触发 advanceCrystallizeStage 推进流水线
 * 测试 advanceCrystallizeStage 的核心推进逻辑（直接单元测试）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
};
vi.mock('../db.js', () => ({ default: mockPool }));

// 动态导入被测模块（避免 top-level await 问题）
let advanceCrystallizeStage;
let CRYSTALLIZE_STAGES;

beforeEach(async () => {
  vi.resetModules();
  vi.mock('../db.js', () => ({ default: mockPool }));
  const mod = await import('../crystallize-orchestrator.js');
  advanceCrystallizeStage = mod.advanceCrystallizeStage;
  CRYSTALLIZE_STAGES = mod.CRYSTALLIZE_STAGES;
  vi.clearAllMocks();
  mockPool.query.mockResolvedValue({ rows: [] });
});

describe('advanceCrystallizeStage', () => {
  const pipelineId = 'pipeline-001';
  const forgeTaskId = 'forge-task-001';
  const target = 'test-automation-scenario';

  function mockForgeTask() {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT id, task_type, payload, project_id, goal_id, priority')) {
        return {
          rows: [{
            id: forgeTaskId,
            task_type: 'crystallize_forge',
            priority: 'P2',
            project_id: null,
            goal_id: null,
            payload: {
              parent_crystallize_id: pipelineId,
              pipeline_stage: 'crystallize_forge',
              pipeline_target: target,
              retry_count: 0,
            },
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  it('crystallize_forge 完成 → 创建 crystallize_verify 子任务', async () => {
    mockForgeTask();

    await advanceCrystallizeStage(forgeTaskId, 'completed', { script_path: '/tmp/test.cjs' });

    // 验证创建了子任务（task_type 在参数中，不在 SQL 文本里）
    const insertCall = mockPool.query.mock.calls.find(
      ([sql, params]) => sql.includes('INSERT INTO tasks') && Array.isArray(params) && params.includes('crystallize_verify')
    );
    expect(insertCall).toBeDefined();

    // 验证 script_path 被传递到下一阶段的 payload（payload 是第8个参数，index=7）
    const insertPayload = JSON.parse(insertCall[1][7]);
    expect(insertPayload.parent_crystallize_id).toBe(pipelineId);
    expect(insertPayload.pipeline_stage).toBe('crystallize_verify');
    expect(insertPayload.script_path).toBe('/tmp/test.cjs');
  });

  it('crystallize_forge 失败 → pipeline 标记 failed', async () => {
    mockForgeTask();

    await advanceCrystallizeStage(forgeTaskId, 'failed', {});

    const updateCall = mockPool.query.mock.calls.find(
      ([sql]) => sql.includes("status = 'failed'") && sql.includes('completed_at = NOW()')
    );
    expect(updateCall).toBeDefined();
    // 更新的是 pipeline ID
    expect(updateCall[1]).toContain(pipelineId);
  });

  it('crystallize_verify 失败（verify_passed=false，retry_count=0）→ 重建 crystallize_forge', async () => {
    const verifyTaskId = 'verify-task-001';
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT id, task_type, payload, project_id, goal_id, priority')) {
        return {
          rows: [{
            id: verifyTaskId,
            task_type: 'crystallize_verify',
            priority: 'P2',
            project_id: null,
            goal_id: null,
            payload: {
              parent_crystallize_id: pipelineId,
              pipeline_stage: 'crystallize_verify',
              pipeline_target: target,
              retry_count: 0,
              script_path: '/tmp/test.cjs',
            },
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await advanceCrystallizeStage(verifyTaskId, 'completed', { verify_passed: false, feedback: 'assertion failed' });

    const retryCall = mockPool.query.mock.calls.find(
      ([sql, params]) => sql.includes('INSERT INTO tasks') && Array.isArray(params) && params.includes('crystallize_forge')
    );
    expect(retryCall).toBeDefined();
    const retryPayload = JSON.parse(retryCall[1][7]);
    expect(retryPayload.retry_count).toBe(1);
    expect(retryPayload.verify_feedback).toBe('assertion failed');
  });

  it('CRYSTALLIZE_STAGES 包含4个阶段，有序', () => {
    expect(CRYSTALLIZE_STAGES).toEqual([
      'crystallize_scope',
      'crystallize_forge',
      'crystallize_verify',
      'crystallize_register',
    ]);
  });

  it('task 无 parent_crystallize_id → 直接返回（不推进）', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{
        id: 'orphan-task',
        task_type: 'crystallize_forge',
        priority: 'P2',
        project_id: null,
        goal_id: null,
        payload: { pipeline_stage: 'crystallize_forge' }, // 无 parent_crystallize_id
      }],
    });

    await advanceCrystallizeStage('orphan-task', 'completed', {});

    // 没有 INSERT 调用
    const insertCall = mockPool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO tasks'));
    expect(insertCall).toBeUndefined();
  });
});
