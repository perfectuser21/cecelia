/**
 * content-pipeline 错误可观测性测试
 * 验证失败路径正确写入 error_message 字段（tasks 表 migration #142 列）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock content-type-registry
vi.mock('../content-types/content-type-registry.js', () => ({
  getContentType: vi.fn(),
}));

// Mock executors（用于测试子任务执行失败路径）
vi.mock('../content-pipeline-executors.js', () => ({
  executeResearch: vi.fn(),
  executeCopywriting: vi.fn(),
  executeCopyReview: vi.fn(),
  executeGenerate: vi.fn(),
  executeImageReview: vi.fn(),
  executeExport: vi.fn(),
}));

import { getContentType } from '../content-types/content-type-registry.js';
import { executeResearch } from '../content-pipeline-executors.js';
import {
  orchestrateContentPipelines,
  executeQueuedContentTasks,
  advanceContentPipeline,
} from '../content-pipeline-orchestrator.js';

// ── Mock DB Pool 工厂 ────────────────────────────────────────

function makePool() {
  const updates = [];

  const pool = {
    query: vi.fn(async () => ({ rows: [] })),
    updates,
  };

  return pool;
}

// ── 1. content_type 无效时 error_message 写入父 pipeline ────────

describe('content_type 无效时 error_message 写入父 pipeline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('UPDATE 应包含 error_message', async () => {
    getContentType.mockResolvedValue(null);

    const pool = makePool();
    pool.query = vi.fn(async (sql, params) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('UPDATE tasks')) {
        pool.updates.push({ sql: s, params: params || [] });
        return { rows: [] };
      }
      if (s.includes("task_type = 'content-pipeline'") && s.includes("status = 'queued'")) {
        return { rows: [{ id: 'pipe-1', title: '[内容工厂] 测试', goal_id: null, project_id: null, payload: { keyword: '测试', content_type: 'nonexistent-type' } }] };
      }
      if (s.includes("task_type = 'content-research'")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    await orchestrateContentPipelines(pool);

    const failedUpdates = pool.updates.filter(u => u.params.includes('failed'));
    expect(failedUpdates.length).toBeGreaterThan(0);

    const updateWithErrorMsg = failedUpdates.find(u => u.sql.includes('error_message'));
    expect(updateWithErrorMsg).toBeDefined();
  });
});

// ── 2. executor 抛出异常时 error_message 写入子任务 ──────────────

describe('executor 抛出异常时 error_message 写入', () => {
  beforeEach(() => vi.clearAllMocks());

  it('catch 块 UPDATE 应包含 error_message 和异常信息', async () => {
    executeResearch.mockRejectedValue(new Error('NotebookLM 连接超时'));

    const pool = makePool();
    let stageServed = false;
    pool.query = vi.fn(async (sql, params) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('UPDATE tasks')) {
        pool.updates.push({ sql: s, params: params || [] });
        return { rows: [] };
      }
      if (s.includes("status = 'queued'") && s.includes("parent_pipeline_id' IS NOT NULL")) {
        if (!stageServed) {
          stageServed = true;
          return { rows: [{ id: 'task-1', title: '[内容调研] 测试', task_type: 'content-research', payload: { parent_pipeline_id: 'pipe-1', pipeline_keyword: '测试' }, project_id: null, goal_id: null }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    });

    await executeQueuedContentTasks(pool);

    const errorUpdate = pool.updates.find(u =>
      u.sql.includes('error_message') && u.params.includes('failed')
    );
    expect(errorUpdate).toBeDefined();
    const errMsgParam = errorUpdate.params.find(p =>
      typeof p === 'string' && p.includes('NotebookLM')
    );
    expect(errMsgParam).toBeTruthy();
  });
});

// ── 3. copy-review 重试达上限时 parent pipeline error_message ───

describe('copy-review 重试达上限时 error_message 写入 parent pipeline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('超出最大重试次数，父 pipeline UPDATE 应包含 error_message', async () => {
    getContentType.mockResolvedValue({ content_type: 'solo-company-case' });

    const pool = makePool();
    let selectCount = 0;
    pool.query = vi.fn(async (sql, params) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('UPDATE tasks')) {
        pool.updates.push({ sql: s, params: params || [] });
        return { rows: [] };
      }
      if (s.includes('FROM tasks') && s.includes('WHERE id = $1')) {
        selectCount++;
        if (selectCount === 1) {
          return { rows: [{ id: 'review-1', title: '[文案审核] 测试', task_type: 'content-copy-review', project_id: null, goal_id: null, payload: { parent_pipeline_id: 'pipe-1', pipeline_stage: 'content-copy-review', pipeline_keyword: '测试', retry_count: 3 } }] };
        }
        return { rows: [{ id: 'pipe-1', title: '[内容工厂] 测试', goal_id: null, project_id: null, payload: { keyword: '测试', content_type: 'solo-company-case' }, status: 'in_progress' }] };
      }
      return { rows: [] };
    });

    await advanceContentPipeline('review-1', 'completed', { review_passed: false }, pool);

    const failedUpdate = pool.updates.find(u =>
      u.params.includes('failed') && u.sql.includes('error_message')
    );
    expect(failedUpdate).toBeDefined();
    const errMsg = failedUpdate.params.find(p =>
      typeof p === 'string' && (p.includes('上限') || p.includes('retry') || p.includes('重试'))
    );
    expect(errMsg).toBeTruthy();
  });
});
