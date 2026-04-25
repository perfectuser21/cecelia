import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../orchestrator/pg-checkpointer.js', () => ({
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
  buildContentPipelineGraph,
  createContentDockerNodes,
} from '../workflows/content-pipeline.graph.js';

describe('runDockerNode resume idempotency gate', () => {
  it('skips spawn when state already has primary output (research.findings_path)', async () => {
    const mockExecutor = vi.fn();
    const fakeTask = { id: 'resume-test-1', payload: {} };
    const nodes = createContentDockerNodes(mockExecutor, fakeTask, {});
    const stateWithOutput = {
      pipeline_id: 'pipe-1',
      output_dir: '/tmp/p',
      findings_path: '/tmp/p/research/findings.md',  // 幂等门触发字段
    };
    const delta = await nodes.research(stateWithOutput);
    // 幂等门核心断言：mockExecutor 未被调用 → 没起 docker
    expect(mockExecutor).not.toHaveBeenCalled();
    // makeNode flatten meta 到顶层 → delta.resumed 标识 resumed
    expect(delta.resumed).toBe(true);
    expect(delta.error).toBeNull();
  });
});

describe('stateHasError short-circuit (non-verdict nodes only)', () => {
  it('research error → graph END without invoking copywrite', async () => {
    const calls = [];
    const overrides = {
      research:     async () => { calls.push('research'); return { error: 'docker died' }; },
      copywrite:    async () => { calls.push('copywrite'); return {}; },
      copy_review:  async () => { calls.push('copy_review'); return { copy_review_verdict: 'APPROVED' }; },
      generate:     async () => { calls.push('generate'); return {}; },
      image_review: async () => { calls.push('image_review'); return { image_review_verdict: 'PASS' }; },
      export:       async () => { calls.push('export'); return {}; },
    };
    const app = await compileContentPipelineApp({ overrides });
    const out = await app.invoke(
      { pipeline_id: 'p1', keyword: 'k', output_dir: '/tmp' },
      { configurable: { thread_id: 'short-circuit-test' } }
    );
    expect(calls).toEqual(['research']);  // 仅 research 跑，error → END
    expect(out.error).toBe('docker died');
  });

  it('verdict node (copy_review) error does NOT short-circuit (round>=3 兜底承担)', async () => {
    // 验证 verdict 节点不嵌 stateHasError：copy_review 即使 state.error 也走 verdict 路由
    // 这个测试不强求 path，只确认 graph 不在 copy_review 后立即 END
    const calls = [];
    const overrides = {
      research:     async () => { calls.push('research'); return { findings_path: '/tmp/r' }; },
      copywrite:    async () => { calls.push('copywrite'); return { copy_path: '/tmp/c' }; },
      copy_review:  async () => { calls.push('copy_review'); return { copy_review_verdict: 'APPROVED', error: 'flake' }; },
      generate:     async () => { calls.push('generate'); return { images_dir: '/tmp/g' }; },
      image_review: async () => { calls.push('image_review'); return { image_review_verdict: 'PASS' }; },
      export:       async () => { calls.push('export'); return { final_post_path: '/tmp/e' }; },
    };
    const app = await compileContentPipelineApp({ overrides });
    await app.invoke(
      { pipeline_id: 'p2', keyword: 'k', output_dir: '/tmp' },
      { configurable: { thread_id: 'verdict-no-short-circuit-test' } }
    );
    // copy_review 后必须流到 generate（verdict APPROVED），证明 verdict 节点 error 不短路
    expect(calls).toContain('generate');
  });
});
