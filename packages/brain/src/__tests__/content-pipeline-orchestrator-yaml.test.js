/**
 * content-pipeline-orchestrator YAML 配置集成测试
 * 验证 Pipeline 正确读取 content-type-registry YAML 配置（6 阶段）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock content-type-registry
vi.mock('../content-types/content-type-registry.js', () => ({
  getContentType: vi.fn(),
}));

import { getContentType } from '../content-types/content-type-registry.js';
import { orchestrateContentPipelines, advanceContentPipeline } from '../content-pipeline-orchestrator.js';

// ── Mock DB Pool 工厂 ──────────────────────────────────

function makeMockPool(overrides = {}) {
  const rows = {
    pipelines: [],
    existing: [],
    task: null,
    parentPipeline: null,
    ...overrides,
  };

  let insertedPayload = null;
  let updatedStatus = null;

  const pool = {
    query: vi.fn(async (sql, params) => {
      const s = sql.replace(/\s+/g, ' ').trim();

      // SELECT pipelines
      if (s.includes("task_type = 'content-pipeline'") && s.includes("status = 'queued'")) {
        return { rows: rows.pipelines };
      }
      // SELECT existing content-research
      if (s.includes("task_type = 'content-research'")) {
        return { rows: rows.existing };
      }
      // SELECT existing next stage (幂等检查)
      if (s.includes('status IN') && s.includes('queued') && s.includes('in_progress') && !s.includes('completed')) {
        return { rows: [] };
      }
      // SELECT task by id (advanceContentPipeline)
      if (s.includes('FROM tasks') && s.includes('WHERE id = $1') && rows.task) {
        return { rows: [rows.task] };
      }
      // SELECT parent pipeline
      if (s.includes('FROM tasks') && s.includes('WHERE id = $1') && rows.parentPipeline) {
        return { rows: [rows.parentPipeline] };
      }
      // INSERT (capture payload)
      if (s.startsWith('INSERT INTO tasks')) {
        insertedPayload = params ? JSON.parse(params[7]) : null;
        pool._insertedTitle = params?.[0];
        pool._insertedDescription = params?.[1];
        return { rows: [] };
      }
      // UPDATE
      if (s.startsWith('UPDATE tasks')) {
        updatedStatus = params;
        pool._updatedStatus = params;
        return { rows: [] };
      }
      return { rows: [] };
    }),
    _getInsertedPayload: () => insertedPayload,
    _getUpdatedStatus: () => updatedStatus,
  };

  return pool;
}

const MOCK_TYPE_CONFIG = {
  content_type: 'solo-company-case',
  title: '一人公司成功案例',
  notebook_id: '1d928181-4462-47d4-b4c0-89d3696344ab',
  images: { count: 9, format: 'svg' },
  template: {
    generate_prompt: '基于调研报告，生成关于 {keyword} 的9张信息图和图文内容。',
    research_prompt: '调研 {keyword}',
  },
  review_rules: [
    { id: 'data_accuracy', description: '数据必须有来源', severity: 'blocking' },
    { id: 'actionable_advice', description: '至少3条可操作建议', severity: 'blocking' },
  ],
  copy_rules: { platform_tone: { xiaohongshu: '口语化' } },
};

// ── orchestrateContentPipelines 测试 ──────────────────

describe('orchestrateContentPipelines — YAML 配置集成', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('content_type 不存在于注册表时，pipeline 标记 failed', async () => {
    getContentType.mockResolvedValue(null); // 类型不存在

    const pool = makeMockPool({
      pipelines: [{
        id: 'pipe-001',
        title: '测试 Pipeline',
        payload: { keyword: 'Dan Koe', content_type: 'nonexistent-type' },
        project_id: null,
        goal_id: null,
      }],
    });

    const result = await orchestrateContentPipelines(pool);

    expect(getContentType).toHaveBeenCalledWith('nonexistent-type');
    expect(pool._updatedStatus).toBeTruthy();
    expect(result.summary.skipped).toBe(1);
    expect(result.summary.orchestrated).toBe(0);
  });

  it('content_type 存在时，content-research 子任务 payload 含 content_type', async () => {
    getContentType.mockResolvedValue(MOCK_TYPE_CONFIG);

    const pool = makeMockPool({
      pipelines: [{
        id: 'pipe-002',
        title: '一人公司 Pipeline',
        payload: { keyword: 'Dan Koe', content_type: 'solo-company-case' },
        project_id: null,
        goal_id: null,
      }],
      existing: [],
    });

    await orchestrateContentPipelines(pool);

    const inserted = pool._getInsertedPayload();
    expect(inserted).toBeTruthy();
    expect(inserted.content_type).toBe('solo-company-case');
    expect(inserted.pipeline_stage).toBe('content-research');
  });

  it('无 content_type 时使用默认 solo-company-case 照常启动', async () => {
    getContentType.mockResolvedValue(MOCK_TYPE_CONFIG);

    const pool = makeMockPool({
      pipelines: [{
        id: 'pipe-003',
        title: '旧格式 Pipeline',
        payload: { keyword: '某博主' },
        project_id: null,
        goal_id: null,
      }],
      existing: [],
    });

    const result = await orchestrateContentPipelines(pool);

    // 修复后：无 content_type 时默认使用 solo-company-case，getContentType 会被调用
    expect(getContentType).toHaveBeenCalledWith('solo-company-case');
    expect(result.summary.orchestrated).toBe(1);
  });

  it('typeConfig 有 notebook_id 时，research task payload 自动携带 notebook_id', async () => {
    getContentType.mockResolvedValue(MOCK_TYPE_CONFIG);

    const pool = makeMockPool({
      pipelines: [{
        id: 'pipe-010',
        title: '含 notebook_id Pipeline',
        payload: { keyword: 'Dan Koe', content_type: 'solo-company-case' },
        project_id: null,
        goal_id: null,
      }],
      existing: [],
    });

    await orchestrateContentPipelines(pool);

    const inserted = pool._getInsertedPayload();
    expect(inserted).toBeTruthy();
    expect(inserted.notebook_id).toBe('1d928181-4462-47d4-b4c0-89d3696344ab');
    expect(inserted.pipeline_stage).toBe('content-research');
  });

  it('typeConfig 无 notebook_id 时，research task payload 不含 notebook_id', async () => {
    getContentType.mockResolvedValue({ ...MOCK_TYPE_CONFIG, notebook_id: undefined });

    const pool = makeMockPool({
      pipelines: [{
        id: 'pipe-011',
        title: '无 notebook_id Pipeline',
        payload: { keyword: 'Justin Welsh', content_type: 'solo-company-case' },
        project_id: null,
        goal_id: null,
      }],
      existing: [],
    });

    await orchestrateContentPipelines(pool);

    const inserted = pool._getInsertedPayload();
    expect(inserted).toBeTruthy();
    expect(inserted.notebook_id).toBeUndefined();
  });
});

// ── advanceContentPipeline — content-generate 阶段（YAML 配置从 copy-review PASS 传入）───

describe('advanceContentPipeline — content-generate YAML 配置', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('content-copy-review PASS → content-generate payload 含 images_count（来自 YAML）', async () => {
    getContentType.mockResolvedValue(MOCK_TYPE_CONFIG);

    const copyReviewTask = {
      id: 'task-cr-001',
      task_type: 'content-copy-review',
      project_id: null,
      goal_id: null,
      payload: {
        parent_pipeline_id: 'pipe-002',
        pipeline_keyword: 'Dan Koe',
        content_type: 'solo-company-case',
        retry_count: 0,
      },
    };
    const parentPipeline = {
      id: 'pipe-002',
      title: '一人公司',
      payload: { keyword: 'Dan Koe', content_type: 'solo-company-case' },
      project_id: null,
      goal_id: null,
      status: 'in_progress',
    };

    let callCount = 0;
    const pool = {
      query: vi.fn(async (sql, params) => {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.includes('FROM tasks') && s.includes('WHERE id = $1')) {
          callCount++;
          if (callCount === 1) return { rows: [copyReviewTask] };
          return { rows: [parentPipeline] };
        }
        if (s.includes('status IN') && !s.includes('completed')) {
          return { rows: [] };
        }
        if (s.startsWith('INSERT INTO tasks')) {
          pool._insertedPayload = params ? JSON.parse(params[7]) : null;
          pool._insertedDescription = params?.[1];
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    await advanceContentPipeline('task-cr-001', 'completed', { review_passed: true }, pool);

    expect(pool._insertedPayload).toBeTruthy();
    expect(pool._insertedPayload.images_count).toBe(9);
    expect(pool._insertedPayload.content_type).toBe('solo-company-case');
  });

  it('content-copy-review PASS → content-generate description 包含 YAML generate_prompt', async () => {
    getContentType.mockResolvedValue(MOCK_TYPE_CONFIG);

    const copyReviewTask = {
      id: 'task-cr-002',
      task_type: 'content-copy-review',
      project_id: null,
      goal_id: null,
      payload: {
        parent_pipeline_id: 'pipe-003',
        pipeline_keyword: 'Dan Koe',
        content_type: 'solo-company-case',
        retry_count: 0,
      },
    };
    const parentPipeline = {
      id: 'pipe-003',
      title: '一人公司',
      payload: { keyword: 'Dan Koe', content_type: 'solo-company-case' },
      project_id: null,
      goal_id: null,
      status: 'in_progress',
    };

    let callCount = 0;
    const pool = {
      query: vi.fn(async (sql, params) => {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.includes('FROM tasks') && s.includes('WHERE id = $1')) {
          callCount++;
          if (callCount === 1) return { rows: [copyReviewTask] };
          return { rows: [parentPipeline] };
        }
        if (s.includes('status IN') && !s.includes('completed')) {
          return { rows: [] };
        }
        if (s.startsWith('INSERT INTO tasks')) {
          pool._insertedDescription = params?.[1];
          pool._insertedPayload = params ? JSON.parse(params[7]) : null;
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    await advanceContentPipeline('task-cr-002', 'completed', { review_passed: true }, pool);

    expect(pool._insertedDescription).toContain('Dan Koe');
    expect(pool._insertedDescription).toContain('9张信息图');
  });

  it('content-image-review payload 含 review_rules（来自 YAML）', async () => {
    getContentType.mockResolvedValue(MOCK_TYPE_CONFIG);

    const generateTask = {
      id: 'task-gen-001',
      task_type: 'content-generate',
      project_id: null,
      goal_id: null,
      payload: {
        parent_pipeline_id: 'pipe-004',
        pipeline_keyword: 'Dan Koe',
        content_type: 'solo-company-case',
        retry_count: 0,
      },
    };
    const parentPipeline = {
      id: 'pipe-004',
      title: '一人公司',
      payload: { keyword: 'Dan Koe', content_type: 'solo-company-case' },
      project_id: null,
      goal_id: null,
      status: 'in_progress',
    };

    let callCount = 0;
    const pool = {
      query: vi.fn(async (sql, params) => {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.includes('FROM tasks') && s.includes('WHERE id = $1')) {
          callCount++;
          if (callCount === 1) return { rows: [generateTask] };
          return { rows: [parentPipeline] };
        }
        if (s.includes('status IN') && !s.includes('completed')) {
          return { rows: [] };
        }
        if (s.startsWith('INSERT INTO tasks')) {
          pool._insertedPayload = params ? JSON.parse(params[7]) : null;
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    await advanceContentPipeline('task-gen-001', 'completed', null, pool);

    expect(pool._insertedPayload).toBeTruthy();
    expect(pool._insertedPayload.review_rules).toBeDefined();
    expect(Array.isArray(pool._insertedPayload.review_rules)).toBe(true);
    expect(pool._insertedPayload.review_rules.length).toBe(2);
    expect(pool._insertedPayload.review_rules[0].id).toBe('data_accuracy');
  });
});
