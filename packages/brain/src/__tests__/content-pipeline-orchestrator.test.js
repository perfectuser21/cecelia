/**
 * content-pipeline-orchestrator.test.js
 *
 * 单元测试：content-pipeline 状态机核心逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  orchestrateContentPipelines,
  advanceContentPipeline,
  PIPELINE_STAGES,
  MAX_REVIEW_RETRY,
} from '../content-pipeline-orchestrator.js';

// ──────────────────────────────────────────
// 常量
// ──────────────────────────────────────────

describe('constants', () => {
  it('PIPELINE_STAGES 有 4 个正确顺序的阶段', () => {
    expect(PIPELINE_STAGES).toEqual([
      'content-research',
      'content-generate',
      'content-review',
      'content-export',
    ]);
  });

  it('MAX_REVIEW_RETRY = 3', () => {
    expect(MAX_REVIEW_RETRY).toBe(3);
  });
});

// ──────────────────────────────────────────
// orchestrateContentPipelines
// ──────────────────────────────────────────

describe('orchestrateContentPipelines', () => {
  it('无 queued pipeline 时返回 total_actions=0', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    };
    const result = await orchestrateContentPipelines(pool);
    expect(result.total_actions).toBe(0);
    expect(result.summary.orchestrated).toBe(0);
  });

  it('queued pipeline → 创建 content-research 子任务 + pipeline 标 in_progress', async () => {
    const insertCalls = [];
    const updateCalls = [];
    let callCount = 0;

    const pool = {
      query: vi.fn(async (sql, params) => {
        const trimmed = sql.trim();
        if (trimmed.startsWith('SELECT id, title, goal_id, project_id, payload')) {
          return {
            rows: [{
              id: 'pipeline-1',
              title: 'AI创业教程',
              goal_id: 'goal-1',
              project_id: 'proj-1',
              payload: { keyword: 'AI创业', priority: 'P1' },
            }],
          };
        }
        if (trimmed.startsWith('SELECT id FROM tasks')) {
          return { rows: [] };  // 幂等检查：无现有子任务
        }
        if (trimmed.startsWith('INSERT INTO tasks')) {
          insertCalls.push(params);
          return { rows: [] };
        }
        if (trimmed.startsWith('UPDATE tasks')) {
          updateCalls.push(params);
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    const result = await orchestrateContentPipelines(pool);
    expect(result.total_actions).toBe(1);
    expect(result.summary.orchestrated).toBe(1);
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0][0]).toContain('内容调研');  // title
    expect(insertCalls[0][2]).toBe('content-research');  // task_type
    expect(updateCalls.length).toBe(1);  // pipeline → in_progress
  });

  it('已有 content-research 子任务时跳过（幂等）', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        const trimmed = sql.trim();
        if (trimmed.startsWith('SELECT id, title, goal_id, project_id, payload')) {
          return {
            rows: [{
              id: 'pipeline-2',
              title: '测试主题',
              goal_id: 'goal-1',
              project_id: 'proj-1',
              payload: {},
            }],
          };
        }
        if (trimmed.startsWith('SELECT id FROM tasks')) {
          return { rows: [{ id: 'existing-research-1' }] };  // 已有子任务
        }
        return { rows: [] };
      }),
    };

    const result = await orchestrateContentPipelines(pool);
    expect(result.summary.skipped).toBe(1);
    expect(result.summary.orchestrated).toBe(0);
  });
});

// ──────────────────────────────────────────
// advanceContentPipeline
// ──────────────────────────────────────────

describe('advanceContentPipeline', () => {
  it('无 parent_pipeline_id 的任务 → 返回 advanced=false', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{
          id: 'task-1',
          task_type: 'content-research',
          project_id: 'proj-1',
          goal_id: 'goal-1',
          payload: {},  // 无 parent_pipeline_id
        }],
      })),
    };
    const result = await advanceContentPipeline('task-1', 'completed', null, pool);
    expect(result.advanced).toBe(false);
  });

  it('非 pipeline 子任务类型 → 返回 advanced=false', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{
          id: 'task-1',
          task_type: 'dev',  // 非 pipeline 类型
          project_id: 'proj-1',
          goal_id: 'goal-1',
          payload: { parent_pipeline_id: 'pipeline-1' },
        }],
      })),
    };
    const result = await advanceContentPipeline('task-1', 'completed', null, pool);
    expect(result.advanced).toBe(false);
  });

  it('content-research 完成 → 创建 content-generate', async () => {
    const insertCalls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        const trimmed = sql.trim();
        if (trimmed.startsWith('SELECT id, title, task_type')) {
          return {
            rows: [{
              id: 'task-1',
              title: '[内容调研] AI创业',
              task_type: 'content-research',
              project_id: 'proj-1',
              goal_id: 'goal-1',
              payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业' },
            }],
          };
        }
        if (trimmed.startsWith('SELECT id, title, goal_id, project_id, payload, status')) {
          return {
            rows: [{
              id: 'pipeline-1',
              title: 'AI创业内容',
              goal_id: 'goal-1',
              project_id: 'proj-1',
              payload: { keyword: 'AI创业' },
              status: 'in_progress',
            }],
          };
        }
        if (trimmed.startsWith('SELECT id FROM tasks')) {
          return { rows: [] };
        }
        if (trimmed.startsWith('INSERT INTO tasks')) {
          insertCalls.push(params);
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    const result = await advanceContentPipeline('task-1', 'completed', null, pool);
    expect(result.advanced).toBe(true);
    expect(result.action).toBe('created_content_generate');
    expect(insertCalls[0][2]).toBe('content-generate');
  });

  it('content-generate 完成 → 创建 content-review', async () => {
    const insertCalls = [];
    const pool = {
      query: vi.fn(async (sql) => {
        const trimmed = sql.trim();
        if (trimmed.startsWith('SELECT id, title, task_type')) {
          return {
            rows: [{
              id: 'gen-1',
              title: '[内容生成] AI创业',
              task_type: 'content-generate',
              project_id: 'proj-1',
              goal_id: 'goal-1',
              payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 0 },
            }],
          };
        }
        if (trimmed.startsWith('SELECT id, title, goal_id, project_id, payload, status')) {
          return {
            rows: [{
              id: 'pipeline-1',
              title: 'AI创业内容',
              goal_id: 'goal-1',
              project_id: 'proj-1',
              payload: { keyword: 'AI创业' },
              status: 'in_progress',
            }],
          };
        }
        if (trimmed.startsWith('SELECT id FROM tasks')) {
          return { rows: [] };
        }
        if (trimmed.startsWith('INSERT INTO tasks')) {
          insertCalls.push(sql);
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    // 注意：插入的 params 包含 task_type
    const insertParamCalls = [];
    pool.query = vi.fn(async (sql, params) => {
      const trimmed = sql.trim();
      if (trimmed.startsWith('SELECT id, title, task_type')) {
        return { rows: [{ id: 'gen-1', task_type: 'content-generate', project_id: 'proj-1', goal_id: 'goal-1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 0 } }] };
      }
      if (trimmed.startsWith('SELECT id, title, goal_id, project_id, payload, status')) {
        return { rows: [{ id: 'pipeline-1', title: 'AI创业内容', goal_id: 'goal-1', project_id: 'proj-1', payload: { keyword: 'AI创业' }, status: 'in_progress' }] };
      }
      if (trimmed.startsWith('SELECT id FROM tasks')) return { rows: [] };
      if (trimmed.startsWith('INSERT INTO tasks')) { insertParamCalls.push(params); return { rows: [] }; }
      return { rows: [] };
    });

    const result = await advanceContentPipeline('gen-1', 'completed', null, pool);
    expect(result.advanced).toBe(true);
    expect(result.action).toBe('created_content_review');
    expect(insertParamCalls[0][2]).toBe('content-review');
  });

  it('content-review 通过 → 创建 content-export', async () => {
    const insertCalls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        const trimmed = sql.trim();
        if (trimmed.startsWith('SELECT id, title, task_type')) {
          return { rows: [{ id: 'rev-1', task_type: 'content-review', project_id: 'proj-1', goal_id: 'goal-1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 0 } }] };
        }
        if (trimmed.startsWith('SELECT id, title, goal_id, project_id, payload, status')) {
          return { rows: [{ id: 'pipeline-1', title: 'AI创业内容', goal_id: 'goal-1', project_id: 'proj-1', payload: { keyword: 'AI创业' }, status: 'in_progress' }] };
        }
        if (trimmed.startsWith('SELECT id FROM tasks')) return { rows: [] };
        if (trimmed.startsWith('INSERT INTO tasks')) { insertCalls.push(params); return { rows: [] }; }
        return { rows: [] };
      }),
    };

    const result = await advanceContentPipeline('rev-1', 'completed', { review_passed: true }, pool);
    expect(result.advanced).toBe(true);
    expect(result.action).toBe('created_content_export');
    expect(insertCalls[0][2]).toBe('content-export');
  });

  it('content-review 失败（retry_count=0）→ 重建 content-generate，retry_count=1', async () => {
    const insertCalls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        const trimmed = sql.trim();
        if (trimmed.startsWith('SELECT id, title, task_type')) {
          return { rows: [{ id: 'rev-2', task_type: 'content-review', project_id: 'proj-1', goal_id: 'goal-1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 0 } }] };
        }
        if (trimmed.startsWith('SELECT id, title, goal_id, project_id, payload, status')) {
          return { rows: [{ id: 'pipeline-1', title: 'AI创业内容', goal_id: 'goal-1', project_id: 'proj-1', payload: { keyword: 'AI创业' }, status: 'in_progress' }] };
        }
        if (trimmed.startsWith('SELECT id FROM tasks')) return { rows: [] };
        if (trimmed.startsWith('INSERT INTO tasks')) { insertCalls.push(params); return { rows: [] }; }
        return { rows: [] };
      }),
    };

    const result = await advanceContentPipeline('rev-2', 'completed', { review_passed: false, feedback: '内容太浅' }, pool);
    expect(result.advanced).toBe(true);
    expect(result.action).toBe('created_content_generate');

    const insertedPayload = JSON.parse(insertCalls[0][7]);
    expect(insertedPayload.retry_count).toBe(1);
    expect(insertedPayload.review_feedback).toBe('内容太浅');
  });

  it('content-review 失败（retry_count=3）→ pipeline 标记 failed（达到上限）', async () => {
    const updateCalls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        const trimmed = sql.trim();
        if (trimmed.startsWith('SELECT id, title, task_type')) {
          return { rows: [{ id: 'rev-3', task_type: 'content-review', project_id: 'proj-1', goal_id: 'goal-1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 3 } }] };
        }
        if (trimmed.startsWith('SELECT id, title, goal_id, project_id, payload, status')) {
          return { rows: [{ id: 'pipeline-1', title: 'AI创业内容', goal_id: 'goal-1', project_id: 'proj-1', payload: {}, status: 'in_progress' }] };
        }
        if (trimmed.startsWith('UPDATE tasks')) { updateCalls.push(params); return { rows: [] }; }
        return { rows: [] };
      }),
    };

    const result = await advanceContentPipeline('rev-3', 'completed', { review_passed: false }, pool);
    expect(result.advanced).toBe(true);
    expect(result.action).toBe('pipeline_failed_max_retry');
    expect(updateCalls.some(p => p[0] === 'pipeline-1')).toBe(true);
  });

  it('content-export 完成 → pipeline 标记 completed', async () => {
    const updateCalls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        const trimmed = sql.trim();
        if (trimmed.startsWith('SELECT id, title, task_type')) {
          return { rows: [{ id: 'exp-1', task_type: 'content-export', project_id: 'proj-1', goal_id: 'goal-1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业' } }] };
        }
        if (trimmed.startsWith('SELECT id, title, goal_id, project_id, payload, status')) {
          return { rows: [{ id: 'pipeline-1', title: 'AI创业内容', goal_id: 'goal-1', project_id: 'proj-1', payload: {}, status: 'in_progress' }] };
        }
        if (trimmed.startsWith('UPDATE tasks')) { updateCalls.push(params); return { rows: [] }; }
        return { rows: [] };
      }),
    };

    const result = await advanceContentPipeline('exp-1', 'completed', null, pool);
    expect(result.advanced).toBe(true);
    expect(result.action).toBe('pipeline_completed');
    expect(updateCalls.some(p => p[0] === 'pipeline-1')).toBe(true);
  });

  it('content-review 的 task status=failed 也视为 review 失败，retry_count 递增', async () => {
    const insertCalls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        const trimmed = sql.trim();
        if (trimmed.startsWith('SELECT id, title, task_type')) {
          return { rows: [{ id: 'rev-4', task_type: 'content-review', project_id: 'proj-1', goal_id: 'goal-1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 1 } }] };
        }
        if (trimmed.startsWith('SELECT id, title, goal_id, project_id, payload, status')) {
          return { rows: [{ id: 'pipeline-1', title: 'AI创业内容', goal_id: 'goal-1', project_id: 'proj-1', payload: {}, status: 'in_progress' }] };
        }
        if (trimmed.startsWith('SELECT id FROM tasks')) return { rows: [] };
        if (trimmed.startsWith('INSERT INTO tasks')) { insertCalls.push(params); return { rows: [] }; }
        return { rows: [] };
      }),
    };

    const result = await advanceContentPipeline('rev-4', 'failed', null, pool);
    expect(result.advanced).toBe(true);
    expect(result.action).toBe('created_content_generate');
    const payload = JSON.parse(insertCalls[0][7]);
    expect(payload.retry_count).toBe(2);
  });
});
