/**
 * Brain v2 Phase C2: workflows/index.js (initializeWorkflows) 单元测试。
 *
 * T6 更新：dev-task 已迁离 LangGraph，不再注册到 workflow registry。
 * 刀4a 更新：workflow registry 本身已随死码一起删除，initializeWorkflows
 * 只剩「预热 consciousness graph」一件事，不存在任何注册动作。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock consciousness graph 避免真连 pg
const mocks = vi.hoisted(() => ({
  getCompiledConsciousnessGraph: vi.fn().mockResolvedValue({ invoke: vi.fn() }),
}));

vi.mock('../consciousness.graph.js', () => ({
  getCompiledConsciousnessGraph: mocks.getCompiledConsciousnessGraph,
  _resetCompiledGraphForTests: vi.fn(),
}));

import { initializeWorkflows, _resetInitializedForTests } from '../index.js';

describe('initializeWorkflows()', () => {
  beforeEach(() => {
    mocks.getCompiledConsciousnessGraph.mockClear();
    _resetInitializedForTests();
  });

  it('只预热 consciousness graph', async () => {
    await initializeWorkflows();
    expect(mocks.getCompiledConsciousnessGraph).toHaveBeenCalledTimes(1);
  });

  it('workflow registry 已随死码删除 — import 必失败（无注册入口可复活）', async () => {
    await expect(
      import('../../orchestrator/workflow-registry.js')
    ).rejects.toThrow();
  });

  it('二次调幂等 — 不 throw，且不重复预热', async () => {
    await initializeWorkflows();
    await expect(initializeWorkflows()).resolves.not.toThrow();
    expect(mocks.getCompiledConsciousnessGraph).toHaveBeenCalledTimes(1);
  });

  it('reset 后重新调 initializeWorkflows 能成功', async () => {
    await initializeWorkflows();
    _resetInitializedForTests();
    await expect(initializeWorkflows()).resolves.not.toThrow();
  });
});
