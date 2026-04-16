/**
 * content-pipeline-orchestrator.test.js
 *
 * 单元测试：content-pipeline 状态机核心逻辑（6 阶段）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  orchestrateContentPipelines,
  advanceContentPipeline,
  PIPELINE_STAGES,
  MAX_REVIEW_RETRY,
  PUBLISH_PLATFORMS,
} from '../content-pipeline-orchestrator.js';

// ──────────────────────────────────────────
// 常量
// ──────────────────────────────────────────

describe('constants', () => {
  it('PIPELINE_STAGES 有 6 个正确顺序的阶段', () => {
    expect(PIPELINE_STAGES).toEqual([
      'content-research',
      'content-copywriting',
      'content-copy-review',
      'content-generate',
      'content-image-review',
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
  beforeEach(() => {
    // PIPELINE_SELF_TRIGGER_DISABLED 已废除（阶段3），此 beforeEach 保留为空
  });

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
          return { rows: [] };
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
    expect(insertCalls[0][0]).toContain('内容调研');
    expect(insertCalls[0][2]).toBe('content-research');
    expect(updateCalls.length).toBe(1);
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
          return { rows: [{ id: 'existing-research-1' }] };
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
// advanceContentPipeline — 辅助工具
// ──────────────────────────────────────────

function makeMockPool(taskRow, pipelineRow, onInsert, onUpdate) {
  return {
    query: vi.fn(async (sql, params) => {
      const trimmed = sql.trim();
      if (trimmed.startsWith('SELECT id, title, task_type')) return { rows: [taskRow] };
      if (trimmed.startsWith('SELECT id, title, goal_id, project_id, payload, status')) return { rows: [pipelineRow] };
      if (trimmed.startsWith('SELECT id FROM tasks')) return { rows: [] };
      if (trimmed.startsWith('INSERT INTO tasks')) { if (onInsert) onInsert(params); return { rows: [] }; }
      if (trimmed.startsWith('UPDATE tasks')) { if (onUpdate) onUpdate(params); return { rows: [] }; }
      return { rows: [] };
    }),
  };
}

const PIPELINE_ROW = {
  id: 'pipeline-1', title: 'AI创业内容', goal_id: 'goal-1', project_id: 'proj-1',
  payload: { keyword: 'AI创业' }, status: 'in_progress',
};

// ──────────────────────────────────────────
// advanceContentPipeline — 6 阶段状态机
// ──────────────────────────────────────────

describe('advanceContentPipeline', () => {
  it('无 parent_pipeline_id → advanced=false', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: 't1', task_type: 'content-research', project_id: 'p1', goal_id: 'g1', payload: {} }] })) };
    expect((await advanceContentPipeline('t1', 'completed', null, pool)).advanced).toBe(false);
  });

  it('非 pipeline 类型 → advanced=false', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: 't1', task_type: 'dev', project_id: 'p1', goal_id: 'g1', payload: { parent_pipeline_id: 'p1' } }] })) };
    expect((await advanceContentPipeline('t1', 'completed', null, pool)).advanced).toBe(false);
  });

  // Stage 1→2: research → copywriting
  it('content-research 完成 → 创建 content-copywriting', async () => {
    const ins = [];
    const pool = makeMockPool(
      { id: 't1', task_type: 'content-research', project_id: 'p1', goal_id: 'g1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业' } },
      PIPELINE_ROW, p => ins.push(p),
    );
    const r = await advanceContentPipeline('t1', 'completed', null, pool);
    expect(r.advanced).toBe(true);
    expect(r.action).toBe('created_content_copywriting');
    expect(ins[0][2]).toBe('content-copywriting');
  });

  // Stage 2→3: copywriting → copy-review
  it('content-copywriting 完成 → 创建 content-copy-review', async () => {
    const ins = [];
    const pool = makeMockPool(
      { id: 'cw1', task_type: 'content-copywriting', project_id: 'p1', goal_id: 'g1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 0 } },
      PIPELINE_ROW, p => ins.push(p),
    );
    const r = await advanceContentPipeline('cw1', 'completed', null, pool);
    expect(r.action).toBe('created_content_copy-review');
    expect(ins[0][2]).toBe('content-copy-review');
  });

  // Stage 3 PASS: copy-review → generate
  it('content-copy-review 通过 → 创建 content-generate', async () => {
    const ins = [];
    const pool = makeMockPool(
      { id: 'cr1', task_type: 'content-copy-review', project_id: 'p1', goal_id: 'g1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 0 } },
      PIPELINE_ROW, p => ins.push(p),
    );
    const r = await advanceContentPipeline('cr1', 'completed', { review_passed: true }, pool);
    expect(r.action).toBe('created_content_generate');
    expect(ins[0][2]).toBe('content-generate');
  });

  // Stage 3 FAIL: copy-review → retry copywriting
  it('content-copy-review 失败 → 重建 content-copywriting (retry+1)', async () => {
    const ins = [];
    const pool = makeMockPool(
      { id: 'cr2', task_type: 'content-copy-review', project_id: 'p1', goal_id: 'g1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 0 } },
      PIPELINE_ROW, p => ins.push(p),
    );
    const r = await advanceContentPipeline('cr2', 'completed', { review_passed: false, feedback: '文案太浅' }, pool);
    expect(r.action).toBe('created_content_copywriting');
    const payload = JSON.parse(ins[0][7]);
    expect(payload.retry_count).toBe(1);
    expect(payload.review_feedback).toBe('文案太浅');
  });

  // Stage 3 FAIL max retry → pipeline failed
  it('content-copy-review 失败达上限 → pipeline failed', async () => {
    const upd = [];
    const pool = makeMockPool(
      { id: 'cr3', task_type: 'content-copy-review', project_id: 'p1', goal_id: 'g1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 3 } },
      PIPELINE_ROW, null, p => upd.push(p),
    );
    const r = await advanceContentPipeline('cr3', 'completed', { review_passed: false }, pool);
    expect(r.action).toBe('pipeline_failed_max_retry');
    expect(upd.some(p => p[0] === 'pipeline-1')).toBe(true);
  });

  // Stage 4→5: generate → image-review
  it('content-generate 完成 → 创建 content-image-review', async () => {
    const ins = [];
    const pool = makeMockPool(
      { id: 'g1', task_type: 'content-generate', project_id: 'p1', goal_id: 'g1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 0 } },
      PIPELINE_ROW, p => ins.push(p),
    );
    const r = await advanceContentPipeline('g1', 'completed', null, pool);
    expect(r.action).toBe('created_content_image-review');
    expect(ins[0][2]).toBe('content-image-review');
  });

  // Stage 5 PASS: image-review → export
  it('content-image-review 通过 → 创建 content-export', async () => {
    const ins = [];
    const pool = makeMockPool(
      { id: 'ir1', task_type: 'content-image-review', project_id: 'p1', goal_id: 'g1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 0 } },
      PIPELINE_ROW, p => ins.push(p),
    );
    const r = await advanceContentPipeline('ir1', 'completed', { review_passed: true }, pool);
    expect(r.action).toBe('created_content_export');
    expect(ins[0][2]).toBe('content-export');
  });

  // Stage 5 FAIL: image-review → retry generate
  it('content-image-review 失败 → 重建 content-generate (retry+1)', async () => {
    const ins = [];
    const pool = makeMockPool(
      { id: 'ir2', task_type: 'content-image-review', project_id: 'p1', goal_id: 'g1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 0 } },
      PIPELINE_ROW, p => ins.push(p),
    );
    const r = await advanceContentPipeline('ir2', 'completed', { review_passed: false, feedback: '图片模糊' }, pool);
    expect(r.action).toBe('created_content_generate');
    const payload = JSON.parse(ins[0][7]);
    expect(payload.retry_count).toBe(1);
    expect(payload.review_feedback).toBe('图片模糊');
  });

  // Stage 5 FAIL max retry → pipeline failed
  it('content-image-review 失败达上限 → pipeline failed', async () => {
    const upd = [];
    const pool = makeMockPool(
      { id: 'ir3', task_type: 'content-image-review', project_id: 'p1', goal_id: 'g1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 3 } },
      PIPELINE_ROW, null, p => upd.push(p),
    );
    const r = await advanceContentPipeline('ir3', 'completed', { review_passed: false }, pool);
    expect(r.action).toBe('pipeline_failed_max_retry');
  });

  // Stage 6: export → completed
  it('content-export 完成 → pipeline completed', async () => {
    const upd = [];
    const pool = makeMockPool(
      { id: 'e1', task_type: 'content-export', project_id: 'p1', goal_id: 'g1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业' } },
      PIPELINE_ROW, null, p => upd.push(p),
    );
    const r = await advanceContentPipeline('e1', 'completed', null, pool);
    expect(r.action).toBe('pipeline_completed');
    expect(upd.some(p => p[0] === 'pipeline-1')).toBe(true);
  });

  // task status=failed 也视为 review 失败
  it('content-copy-review status=failed → 重建 copywriting (retry+1)', async () => {
    const ins = [];
    const pool = makeMockPool(
      { id: 'cr4', task_type: 'content-copy-review', project_id: 'p1', goal_id: 'g1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', retry_count: 1 } },
      PIPELINE_ROW, p => ins.push(p),
    );
    const r = await advanceContentPipeline('cr4', 'failed', null, pool);
    expect(r.action).toBe('created_content_copywriting');
    const payload = JSON.parse(ins[0][7]);
    expect(payload.retry_count).toBe(2);
  });
});

// ──────────────────────────────────────────
// PUBLISH_PLATFORMS + content-export → content_publish
// ──────────────────────────────────────────

describe('PUBLISH_PLATFORMS', () => {
  it('包含 8 个发布平台', () => {
    expect(PUBLISH_PLATFORMS).toHaveLength(8);
  });

  it('包含所有必要平台', () => {
    for (const p of ['douyin', 'kuaishou', 'xiaohongshu', 'weibo', 'shipinhao', 'wechat', 'zhihu', 'toutiao']) {
      expect(PUBLISH_PLATFORMS).toContain(p);
    }
  });
});

describe('content-export → content_publish', () => {
  it('为 8 个平台各创建一个 content_publish 任务', async () => {
    const insertCalls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        const trimmed = sql.trim();
        if (trimmed.startsWith('SELECT id, title, task_type')) {
          return { rows: [{ id: 'exp-1', task_type: 'content-export', project_id: 'proj-1', goal_id: 'goal-1', payload: { parent_pipeline_id: 'pipeline-1', pipeline_keyword: 'AI创业', content_type: 'solo-company-case' } }] };
        }
        if (trimmed.startsWith('SELECT id, title, goal_id, project_id, payload, status')) {
          return { rows: [{ id: 'pipeline-1', title: 'AI创业内容', goal_id: 'goal-1', project_id: 'proj-1', payload: { keyword: 'AI创业', content_type: 'solo-company-case' }, status: 'in_progress' }] };
        }
        if (trimmed.startsWith('SELECT id FROM tasks')) return { rows: [] };
        if (trimmed.startsWith('INSERT INTO tasks')) { insertCalls.push(params); return { rows: [] }; }
        if (trimmed.startsWith('UPDATE tasks')) return { rows: [] };
        return { rows: [] };
      }),
    };

    const result = await advanceContentPipeline('exp-1', 'completed', null, pool);
    expect(result.action).toBe('pipeline_completed');
    const publishInserts = insertCalls.filter(p => String(p[0]).startsWith('[发布]'));
    expect(publishInserts).toHaveLength(8);
    const platforms = publishInserts.map(p => JSON.parse(p[6]).platform);
    expect(platforms).toContain('douyin');
    expect(platforms).toContain('wechat');
  });

  it('幂等保护：已存在的平台不重复创建', async () => {
    const insertCalls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        const trimmed = sql.trim();
        if (trimmed.startsWith('SELECT id, title, task_type')) {
          return { rows: [{ id: 'exp-2', task_type: 'content-export', project_id: 'proj-1', goal_id: 'goal-1', payload: { parent_pipeline_id: 'pipeline-2', pipeline_keyword: 'AI创业' } }] };
        }
        if (trimmed.startsWith('SELECT id, title, goal_id, project_id, payload, status')) {
          return { rows: [{ id: 'pipeline-2', title: 'AI创业内容', goal_id: 'goal-1', project_id: 'proj-1', payload: {}, status: 'in_progress' }] };
        }
        if (trimmed.startsWith('SELECT id FROM tasks') && params?.[1]) {
          const existing = ['douyin', 'kuaishou', 'xiaohongshu'];
          return { rows: existing.includes(params[1]) ? [{ id: 'x' }] : [] };
        }
        if (trimmed.startsWith('INSERT INTO tasks')) { insertCalls.push(params); return { rows: [] }; }
        if (trimmed.startsWith('UPDATE tasks')) return { rows: [] };
        return { rows: [] };
      }),
    };

    await advanceContentPipeline('exp-2', 'completed', null, pool);
    const publishInserts = insertCalls.filter(p => String(p[0]).startsWith('[发布]'));
    expect(publishInserts).toHaveLength(5);
  });
});
