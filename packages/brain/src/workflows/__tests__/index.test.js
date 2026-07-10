/**
 * Brain v2 Phase C2: workflows/index.js (initializeWorkflows) 单元测试。
 *
 * T6 更新：dev-task 已迁离 LangGraph，不再注册到 workflow registry。
 * 此测试验证 initializeWorkflows 只预热 consciousness graph，不注册 dev-task。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock consciousness graph 避免真连 pg
vi.mock('../consciousness.graph.js', () => ({
  getCompiledConsciousnessGraph: vi.fn().mockResolvedValue({ invoke: vi.fn() }),
  _resetCompiledGraphForTests: vi.fn(),
}));

// 重置 registry 隔离每 test
import {
  _clearRegistryForTests,
  listWorkflows,
} from '../../orchestrator/workflow-registry.js';
import { initializeWorkflows, _resetInitializedForTests } from '../index.js';

describe('initializeWorkflows()', () => {
  beforeEach(() => {
    _clearRegistryForTests();
    _resetInitializedForTests();
  });

  it('不注册 dev-task（已迁离 LangGraph，走 triggerCeceliaRun）', async () => {
    await initializeWorkflows();
    expect(listWorkflows()).not.toContain('dev-task');
  });

  it('二次调幂等 — 不 throw', async () => {
    await initializeWorkflows();
    await expect(initializeWorkflows()).resolves.not.toThrow();
  });

  it('reset 后重新调 initializeWorkflows 能成功', async () => {
    await initializeWorkflows();
    _clearRegistryForTests();
    _resetInitializedForTests();
    await expect(initializeWorkflows()).resolves.not.toThrow();
  });
});
