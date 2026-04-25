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
