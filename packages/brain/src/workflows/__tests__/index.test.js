/**
 * Brain v2 Phase C2: workflows/index.js (initializeWorkflows) 单元测试。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dev-task compile 避免真连 pg（vi.hoisted 防 top-level 变量 hoisting 冲突）
const { mockCompile } = vi.hoisted(() => ({
  mockCompile: () => Promise.resolve({ invoke: () => {} }),
}));
vi.mock('../dev-task.graph.js', () => ({
  compileDevTaskGraph: mockCompile,
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
    await initializeWorkflows();
    expect(listWorkflows()).toEqual(['dev-task']); // 仍只一个
  });

  it('reset 后重新调 initializeWorkflows 能再次注册', async () => {
    await initializeWorkflows();
    _clearRegistryForTests();
    _resetInitializedForTests();
    await initializeWorkflows();
    expect(listWorkflows()).toContain('dev-task');
  });
});
