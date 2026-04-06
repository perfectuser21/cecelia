/**
 * content-pipeline-notebook-fallback.test.ts
 *
 * 验证修复：content-pipeline 无 content_type 时默认使用 solo-company-case，
 * executeResearch 无 notebook_id payload 时从 typeConfig 查找。
 *
 * 修复背景：recurring task 创建的 content-pipeline 缺少 content_type 字段，
 * 导致 orchestrator 不传 notebook_id 给 research 子任务，进而 executeResearch 直接失败。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ──────────────────────────────────────────────────────────────────────────────
// Mocks（hoisted — 必须在静态 import 前声明）
// ──────────────────────────────────────────────────────────────────────────────

const MOCK_NOTEBOOK_ID = '1d928181-4462-47d4-b4c0-89d3696344ab';

const mockGetContentType = vi.fn(async (type: string) => {
  if (type === 'solo-company-case') {
    return { name: 'solo-company-case', notebook_id: MOCK_NOTEBOOK_ID };
  }
  return null;
});

vi.mock('../content-types/content-type-registry.js', () => ({
  getContentType: (...args: unknown[]) => mockGetContentType(...args as [string]),
}));

vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: '测试文案' }),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
  exec: vi.fn((_cmd: string, _opts: unknown, cb: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(null, '', '');
  }),
}));

vi.mock('../notebook-adapter.js', () => ({
  listSources: vi.fn().mockResolvedValue([]),
  deleteSource: vi.fn().mockResolvedValue({ ok: true }),
  addSource: vi.fn().mockResolvedValue({ ok: true }),
}));

// ──────────────────────────────────────────────────────────────────────────────
// 静态 import（在 vi.mock 后）
// ──────────────────────────────────────────────────────────────────────────────

import { executeResearch } from '../content-pipeline-executors.js';
import { orchestrateContentPipelines } from '../content-pipeline-orchestrator.js';

// ──────────────────────────────────────────────────────────────────────────────
// Test 1: orchestrateContentPipelines — 无 content_type 时使用默认值
// ──────────────────────────────────────────────────────────────────────────────

describe('orchestrateContentPipelines — 默认 content_type fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContentType.mockResolvedValue({ name: 'solo-company-case', notebook_id: MOCK_NOTEBOOK_ID });
  });

  it('pipeline 无 content_type 时，orchestrator 应当查询默认 content type 并将 notebook_id 注入子任务', async () => {
    const insertedPayloads: object[] = [];

    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        const trimmed = sql.trim();

        // 返回一个无 content_type 的 queued pipeline
        if (trimmed.startsWith('SELECT id, title, goal_id, project_id, payload')) {
          return {
            rows: [{
              id: 'pipeline-no-type',
              title: 'AI内容生成每日任务',
              goal_id: 'goal-1',
              project_id: null,
              payload: {
                pipeline_keyword: 'AI内容生成',
                // 故意不设置 content_type
              },
              status: 'queued',
            }],
          };
        }

        // 幂等检查：无现有 research 子任务
        if (trimmed.includes("AND task_type = 'content-research'")) {
          return { rows: [] };
        }

        // 捕获 INSERT（content-research 子任务创建）
        if (trimmed.startsWith('INSERT INTO tasks')) {
          const payloadStr = params?.[7] as string;
          if (payloadStr) {
            try { insertedPayloads.push(JSON.parse(payloadStr)); } catch { /* skip */ }
          }
          return { rows: [{ id: 'research-new' }] };
        }

        // UPDATE pipeline → in_progress
        return { rows: [], rowCount: 1 };
      }),
    };

    await orchestrateContentPipelines(pool as never);

    // 验证 getContentType 被调用，参数为 'solo-company-case'（默认值）
    expect(mockGetContentType).toHaveBeenCalledWith('solo-company-case');

    // 验证插入的子任务 payload 中含有正确的 notebook_id 和 content_type
    const researchPayload = insertedPayloads[0] as Record<string, unknown>;
    expect(researchPayload).toBeDefined();
    expect(researchPayload.notebook_id).toBe(MOCK_NOTEBOOK_ID);
    expect(researchPayload.content_type).toBe('solo-company-case');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 2: executeResearch — notebook_id fallback from typeConfig
// ──────────────────────────────────────────────────────────────────────────────

describe('executeResearch — notebook_id fallback from typeConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContentType.mockResolvedValue({ name: 'solo-company-case', notebook_id: MOCK_NOTEBOOK_ID });
  });

  it('payload 无 notebook_id 时，应从 typeConfig 获取 notebook_id 而不是直接返回失败', async () => {
    const task = {
      id: 'research-1',
      title: '[内容调研] AI创业',
      task_type: 'content-research',
      payload: {
        parent_pipeline_id: 'pipeline-1',
        pipeline_stage: 'content-research',
        pipeline_keyword: 'AI创业',
        content_type: 'solo-company-case',
        // 故意不设置 notebook_id
      },
    };

    const result = await executeResearch(task as never);

    // 验证 typeConfig 被查询（修复前此调用发生在 fail-fast 检查之后，修复后在之前）
    expect(mockGetContentType).toHaveBeenCalledWith('solo-company-case');

    // 结果不应因 notebook_id 缺失而失败（可能因 notebooklm CLI mock 而返回空输出，但不是 notebook_id 错误）
    if (!result.success && result.error) {
      expect(result.error).not.toContain('notebook_id 未配置');
    }
  });
});
