/**
 * content-pipeline-research-fallback.test.ts
 *
 * 验证内容生成引擎 v1 核心修复：
 * 1. executeResearch: 无 notebook_id 时降级到 LLM 直接研究，不返回 {success:false}
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

// Mock notebook-adapter（不应被调用）
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
import { writeFileSync } from 'fs';

// ─── Suite 1: executeResearch LLM fallback ───────────────────

describe('executeResearch — LLM fallback when notebook_id missing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // LLM 返回 5 条 findings（每条内容足够长，能通过 >50 字符过滤）
    mockCallLLM.mockResolvedValue({
      text: '**1. AI能力下放赋能个人\n个人通过AI工具获得公司级运营能力，能力密度替代团队规模。越来越多一人公司月收入超过10万，核心是能力系统化与AI工具深度融合，实现传统公司才有的运营效率。\n\n**2. 一人公司商业模式验证\n月收入10万以上的独立创作者已超过3000人，系统化能力是关键区别。他们通过知识变现+私域运营+自动化工具建立可持续商业模式，而非简单的内容输出。\n\n**3. 系统构建方法论\n使用SOP+工具链建立可复用流程，降低重复性工作70%以上。关键是把每个业务动作抽象成可复用模板，让AI负责执行层，人负责决策层，实现真正的杠杆效应。\n\n**4. 内容变现多路径\n知识付费+私域运营+课程三条路径叠加实现收入增长。单一路径抗风险能力弱，一人公司需要构建收入飞轮，让每条内容都指向转化漏斗，形成自增强的商业闭环。\n\n**5. 效率工具矩阵应用\nAI写作+自动发布+数据分析三合一工具替代传统团队分工。工具矩阵的核心不是工具本身，而是工具之间的协作逻辑，让数据驱动选题、选题驱动创作、创作驱动发布形成闭环。',
    });
  });

  it('当 task 无 notebook_id 时，不返回 {success:false}，而是调用 LLM 完成研究', async () => {
    const task = {
      payload: {
        pipeline_keyword: 'AI能力放大',
        content_type: 'solo-company-case',
        // notebook_id: 刻意缺失
      },
      title: 'AI能力放大',
    };

    const result = await executeResearch(task);

    expect(result.success).toBe(true);
    expect(result.findings_count).toBeGreaterThan(0);
    expect(result.findings_path).toBeDefined();
    // LLM 应被调用一次
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    // 结果文件应被写入
    expect(writeFileSync).toHaveBeenCalled();
  });

  it('LLM fallback 时写入的 findings.json 包含 source: "LLM"', async () => {
    const task = {
      payload: { pipeline_keyword: '一人公司系统' },
      title: '一人公司系统',
    };

    await executeResearch(task);

    const calls = vi.mocked(writeFileSync).mock.calls;
    const findingsCall = calls.find(([path]) => String(path).includes('findings.json'));
    expect(findingsCall).toBeDefined();
    const writtenData = JSON.parse(findingsCall![1] as string);
    expect(writtenData.source).toBe('llm');
    expect(writtenData.findings.length).toBeGreaterThan(0);
  });

  it('当 LLM 调用失败时，返回 {success:false} 并带 error 字段', async () => {
    mockCallLLM.mockRejectedValue(new Error('LLM 服务不可用'));

    const task = {
      payload: { pipeline_keyword: '测试关键词' },
      title: '测试关键词',
    };

    const result = await executeResearch(task);

    expect(result.success).toBe(false);
    expect(result.error).toContain('LLM research failed');
  });

  it('LLM 返回空内容时，返回 {success:false}', async () => {
    mockCallLLM.mockResolvedValue({ text: '' });

    const task = {
      payload: { pipeline_keyword: '空内容测试' },
      title: '空内容测试',
    };

    const result = await executeResearch(task);

    expect(result.success).toBe(false);
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
