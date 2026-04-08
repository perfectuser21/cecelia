/**
 * content-pipeline-research-fallback.test.ts
 *
 * 验证内容生成引擎无降级行为：
 * 1. executeResearch: 无 notebook_id 时直接返回 {success:false}，不调用 LLM
 * 2. _parsePipelineParams: content_type 缺失时默认 'solo-company-case'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

// Mock child_process（run 函数内部用）
vi.mock('child_process', () => ({
  exec: vi.fn((_cmd, _opts, cb) => cb(null, { stdout: '' })),
  execSync: vi.fn(() => ''),
}));

// Mock util.promisify 以控制 run()
vi.mock('util', () => ({
  promisify: vi.fn((fn) => (...args: unknown[]) => new Promise((resolve, reject) => {
    fn(...args, (err: Error | null, result: unknown) => {
      if (err) reject(err); else resolve(result);
    });
  })),
}));

// Mock content type registry
const mockGetContentType = vi.fn().mockResolvedValue(null);
vi.mock('../content-types/content-type-registry.js', () => ({
  getContentType: (...args: unknown[]) => mockGetContentType(...args),
}));

// Mock notebook-adapter
vi.mock('../notebook-adapter.js', () => ({
  listSources: vi.fn().mockResolvedValue({ sources: [] }),
  deleteSource: vi.fn().mockResolvedValue(undefined),
}));

// Mock callLLM
const mockCallLLM = vi.fn();
vi.mock('../llm-caller.js', () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
}));

import { executeResearch } from '../content-pipeline-executors.js';

// ─── Suite 1: executeResearch 无 notebook_id 直接报错 ────────

describe('executeResearch — no LLM fallback when notebook_id missing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('当 task 无 notebook_id 时，直接返回 {success:false} 并带 error 字段', async () => {
    const task = {
      payload: {
        pipeline_keyword: 'AI能力放大',
        content_type: 'solo-company-case',
        // notebook_id: 刻意缺失
      },
      title: 'AI能力放大',
    };

    const result = await executeResearch(task);

    expect(result.success).toBe(false);
    expect(result.error).toContain('notebook_id 未配置');
    // LLM 不应被调用
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('当 notebook_id 明确为 null 时，返回 {success:false}', async () => {
    const task = {
      payload: {
        pipeline_keyword: '一人公司系统',
        notebook_id: null,
      },
      title: '一人公司系统',
    };

    const result = await executeResearch(task);

    expect(result.success).toBe(false);
    expect(result.error).toContain('notebook_id');
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('当 notebook_id 为空字符串时，返回 {success:false}', async () => {
    const task = {
      payload: { pipeline_keyword: '测试关键词', notebook_id: '' },
      title: '测试关键词',
    };

    const result = await executeResearch(task);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('有 notebook_id 时才进入 NotebookLM 流程（LLM 不参与 research）', async () => {
    const task = {
      payload: {
        pipeline_keyword: '有效关键词',
        notebook_id: 'valid-notebook-id-123',
        content_type: 'solo-company-case',
      },
      title: '有效关键词',
    };

    // NotebookLM run() 返回模拟结果（exec mock 返回空，表示 notebook ask 失败）
    // research 因 NotebookLM 返回空会报错
    const result = await executeResearch(task);
    // 不论成功失败，LLM 不应被调用（research 不走 LLM 路径）
    expect(mockCallLLM).not.toHaveBeenCalled();
  });
});

// ─── Suite 2: orchestrator _parsePipelineParams default ─────
describe('orchestrator DEFAULT_CONTENT_TYPE', () => {
  it('content-pipeline-orchestrator.js 源码中存在 DEFAULT_CONTENT_TYPE 常量', () => {
    const { readFileSync: rfs } = require('fs');
    const src = rfs(require('path').join(__dirname, '../content-pipeline-orchestrator.js'), 'utf8');
    expect(src).toContain("DEFAULT_CONTENT_TYPE = 'solo-company-case'");
  });

  it('content-pipeline-orchestrator.js 的 _parsePipelineParams 使用 DEFAULT_CONTENT_TYPE', () => {
    const { readFileSync: rfs } = require('fs');
    const src = rfs(require('path').join(__dirname, '../content-pipeline-orchestrator.js'), 'utf8');
    expect(src).toContain('content_type: pipeline.payload?.content_type || DEFAULT_CONTENT_TYPE');
  });
});

// ─── Suite 3: daily-stats route exists ───────────────────────
describe('daily-stats route', () => {
  it('routes/content-pipeline.js 包含 /daily-stats 路由', () => {
    const { readFileSync: rfs } = require('fs');
    const src = rfs(require('path').join(__dirname, '../routes/content-pipeline.js'), 'utf8');
    expect(src).toContain("router.get('/daily-stats'");
    expect(src).toContain("'content-pipeline'");
    expect(src).toContain('completed');
  });
});
