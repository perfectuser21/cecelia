/**
 * Brain v2 Phase C2: workflows/index.js (initializeWorkflows) 单元测试。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dev-task compile 避免真连 pg（vi.hoisted 防 top-level 变量 hoisting 冲突）
const { mockCompile, mockCompileHarness } = vi.hoisted(() => ({
  mockCompile: () => Promise.resolve({ invoke: () => {} }),
  mockCompileHarness: () => Promise.resolve({ invoke: () => {} }),
}));
vi.mock('../dev-task.graph.js', () => ({
  compileDevTaskGraph: mockCompile,
}));
vi.mock('../harness-initiative.graph.js', () => ({
  compileHarnessInitiativeGraph: mockCompileHarness,
}));
// Mock consciousness graph 避免真连 pg（预热调用不注册到 registry）
vi.mock('../consciousness.graph.js', () => ({
  getCompiledConsciousnessGraph: vi.fn().mockResolvedValue({ invoke: vi.fn() }),
  _resetCompiledGraphForTests: vi.fn(),
}));

// 重置 registry 隔离每 test
import {
  _clearRegistryForTests,
  getWorkflow,
  listWorkflows,
} from '../../orchestrator/workflow-registry.js';
import { initializeWorkflows, _resetInitializedForTests } from '../index.js';

describe('initializeWorkflows()', () => {
  beforeEach(() => {
    _clearRegistryForTests();
    _resetInitializedForTests();
  });

  it('注册 dev-task workflow', async () => {
    await initializeWorkflows();
    const g = getWorkflow('dev-task');
    expect(g).toBeDefined();
    expect(typeof g.invoke).toBe('function');
    expect(listWorkflows()).toContain('dev-task');
  });

  it('二次调幂等 — 不 throw 不重复注册', async () => {
    await initializeWorkflows();
    const after1 = [...listWorkflows()];
    await initializeWorkflows();
    const after2 = [...listWorkflows()];
    expect(after2).toEqual(after1); // 长度与内容均不变
    expect(after2).toContain('dev-task');
  });

  it('reset 后重新调 initializeWorkflows 能再次注册', async () => {
    await initializeWorkflows();
    _clearRegistryForTests();
    _resetInitializedForTests();
    await initializeWorkflows();
    expect(listWorkflows()).toContain('dev-task');
  });
});

describe('initializeWorkflows — harness-initiative', () => {
  beforeEach(() => {
    _clearRegistryForTests();
    _resetInitializedForTests();
  });

  it('注册 harness-initiative workflow', async () => {
    await initializeWorkflows();
    const names = listWorkflows();
    expect(names).toContain('harness-initiative');
    expect(names).toContain('dev-task');
  });

  it('幂等：二次调不抛', async () => {
    await initializeWorkflows();
    await expect(initializeWorkflows()).resolves.toBeUndefined();
  });
});
