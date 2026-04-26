/**
 * Integration Test: content-pipeline 6 节点幂等门（C8b idempotent gate）
 *
 * 验证 createContentDockerNodes 内 runDockerNode 的幂等门行为：
 *   - state[primaryField] 已存在 → skip docker spawn（resume 场景）
 *   - state[primaryField] 缺失 → 调 executor 跑节点
 *
 * 设计要点：
 *   - mock pg-checkpointer（防真连 DB）
 *   - mock executor (vi.fn) 计算调用次数
 *   - 第一次 invoke 起空 state → 6 个节点全跑（executor 调 6 次）
 *   - 第二次 invoke with state.findings_path 已存在 → research 跳过
 *     （executor 调 5 次），graph 仍跑完到 END
 *
 * 走的是真实 LangGraph 编译 + 真实 createContentDockerNodes，
 * 只 stub Docker 执行层和 checkpointer 持久化层 → 验证 wire/门禁逻辑而非外部副作用。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock pg-checkpointer：防真连 PostgreSQL ─────────────────────────────────
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    setup: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    getTuple: vi.fn().mockResolvedValue(null),
    putWrites: vi.fn().mockResolvedValue(undefined),
    getNextVersion: vi.fn((current) => (typeof current === 'number' ? current + 1 : 1)),
  }),
}));

import {
  compileContentPipelineApp,
  createContentDockerNodes,
} from '../../content-pipeline-graph.js';

// ── 节点 → mock stdout 映射 ────────────────────────────────────────────────
// 每节点返回的 stdout 必须满足下游：
//   - extractField 能拿到 outputs[0]（primary），保证下次 resume 能短路
//   - verdict 节点的 stdout 最后一行是 JSON，extractVerdict + extractJsonField 能解析
const NODE_STDOUT = {
  research: 'findings_path: /tmp/findings.json\noutput_dir: /tmp/output',
  copywrite: 'copy_path: /tmp/copy.md\narticle_path: /tmp/article.md',
  copy_review: '{"copy_review_verdict":"APPROVED","copy_review_feedback":"looks good","copy_review_rule_details":[],"copy_review_total":22}',
  generate: 'person_data_path: /tmp/pd.json\ncards_dir: /tmp/cards',
  image_review: '{"image_review_verdict":"PASS","image_review_feedback":"ok","image_review_rule_details":[],"vision_avg":18}',
  export: 'manifest_path: /tmp/manifest.json\nnas_url: nas://demo/path',
};

function makeMockExecutor() {
  // 返回 (calls[]：每次调用的 nodeName，便于断言)
  const calls = [];
  const fn = vi.fn(async ({ env }) => {
    const node = env?.CONTENT_PIPELINE_NODE || 'unknown';
    calls.push(node);
    return {
      exit_code: 0,
      timed_out: false,
      stdout: NODE_STDOUT[node] ?? '',
      stderr: '',
      duration_ms: 5,
      container_id: `mock-${node}`,
    };
  });
  fn.calls = calls;
  return fn;
}

const mockTask = { id: '00000000-1111-2222-3333-444400009999', payload: {} };

describe('content-pipeline 6 节点幂等门 — C8b idempotent gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('空 state 第一次 invoke：6 个节点全跑（executor 调 6 次），到达 END', async () => {
    const executor = makeMockExecutor();
    const nodes = createContentDockerNodes(executor, mockTask);
    const app = await compileContentPipelineApp({ overrides: nodes });

    const finalState = await app.invoke(
      { pipeline_id: 'p-empty-001', keyword: 'demo' },
      { configurable: { thread_id: 'p-empty-001' } },
    );

    // executor 应被调 6 次（每节点 1 次）
    expect(executor).toHaveBeenCalledTimes(6);
    expect(executor.calls).toEqual([
      'research',
      'copywrite',
      'copy_review',
      'generate',
      'image_review',
      'export',
    ]);

    // state 已被各节点产物填满（resume 关键字段）
    expect(finalState.findings_path).toBe('/tmp/findings.json');
    expect(finalState.copy_path).toBe('/tmp/copy.md');
    expect(finalState.copy_review_verdict).toBe('APPROVED');
    expect(finalState.cards_dir).toBe('/tmp/cards');
    expect(finalState.image_review_verdict).toBe('PASS');
    expect(finalState.manifest_path).toBe('/tmp/manifest.json');

    // trace 末尾到 export（graph 跑完到 END）
    expect(Array.isArray(finalState.trace)).toBe(true);
    expect(finalState.trace[finalState.trace.length - 1]).toBe('export');
  });

  it('state.findings_path 已存在的二次 invoke：research 跳过，executor 调用次数减少', async () => {
    const executor = makeMockExecutor();
    const nodes = createContentDockerNodes(executor, mockTask);
    const app = await compileContentPipelineApp({ overrides: nodes });

    const finalState = await app.invoke(
      {
        pipeline_id: 'p-resume-001',
        keyword: 'demo',
        // 模拟"已经跑过 research"——幂等门应短路
        findings_path: '/cached/findings.json',
        output_dir: '/cached/dir',
      },
      { configurable: { thread_id: 'p-resume-001' } },
    );

    // 关键断言：research 没被 executor 调（state.findings_path 已存在 → 短路）
    expect(executor.calls).not.toContain('research');

    // 其余 5 节点正常跑
    expect(executor).toHaveBeenCalledTimes(5);
    expect(executor.calls).toEqual([
      'copywrite',
      'copy_review',
      'generate',
      'image_review',
      'export',
    ]);

    // findings_path 仍然是上一次 cached 的值（research 短路不覆盖 state）
    expect(finalState.findings_path).toBe('/cached/findings.json');

    // graph 仍跑到 END
    expect(finalState.trace[finalState.trace.length - 1]).toBe('export');
  });

  it('多个节点 primary output 已存在：对应节点全部跳过', async () => {
    const executor = makeMockExecutor();
    const nodes = createContentDockerNodes(executor, mockTask);
    const app = await compileContentPipelineApp({ overrides: nodes });

    // 模拟 research/copywrite/generate 都已跑过（primary outputs 都已写入）
    const finalState = await app.invoke(
      {
        pipeline_id: 'p-resume-002',
        keyword: 'demo',
        findings_path: '/cached/findings.json',
        copy_path: '/cached/copy.md',
        person_data_path: '/cached/pd.json',
      },
      { configurable: { thread_id: 'p-resume-002' } },
    );

    // research / copywrite / generate 都短路（primary output 已存在）
    expect(executor.calls).not.toContain('research');
    expect(executor.calls).not.toContain('copywrite');
    expect(executor.calls).not.toContain('generate');

    // copy_review / image_review / export 仍然跑（primary 缺失）
    expect(executor.calls).toEqual([
      'copy_review',
      'image_review',
      'export',
    ]);

    // 短路节点不覆盖 state
    expect(finalState.findings_path).toBe('/cached/findings.json');
    expect(finalState.copy_path).toBe('/cached/copy.md');
    expect(finalState.person_data_path).toBe('/cached/pd.json');

    // 仍到达 END
    expect(finalState.trace[finalState.trace.length - 1]).toBe('export');
  });
});
