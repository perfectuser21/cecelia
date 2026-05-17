/**
 * Brain v2 L2 Orchestrator — workflow-registry 单元测试。
 *
 * 覆盖：
 *   1. registerWorkflow → getWorkflow 双向路径
 *   2. listWorkflows 列名
 *   3. 同名重复注册抛 Error
 *   4. 非法 name / graph 抛 TypeError
 *   5. _clearRegistryForTests 清空
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerWorkflow,
  getWorkflow,
  listWorkflows,
  _clearRegistryForTests,
} from '../workflow-registry.js';

function stubGraph() {
  return { invoke: async () => ({ ok: true }) };
}

describe('workflow-registry', () => {
  beforeEach(() => {
    _clearRegistryForTests();
  });

  it('registerWorkflow + getWorkflow 双向路径', () => {
    const g = stubGraph();
    registerWorkflow('demo', g);
    expect(getWorkflow('demo')).toBe(g);
  });

  it('listWorkflows 返回所有已注册名', () => {
    expect(listWorkflows()).toEqual([]);
    registerWorkflow('a', stubGraph());
    registerWorkflow('b', stubGraph());
    const names = listWorkflows().sort();
    expect(names).toEqual(['a', 'b']);
  });

  it('同名重复注册抛 Error', () => {
    registerWorkflow('dup', stubGraph());
    expect(() => registerWorkflow('dup', stubGraph())).toThrow(/already registered: dup/);
  });

  it('空 name 抛 TypeError', () => {
    expect(() => registerWorkflow('', stubGraph())).toThrow(TypeError);
    expect(() => registerWorkflow(null, stubGraph())).toThrow(TypeError);
    expect(() => registerWorkflow(undefined, stubGraph())).toThrow(TypeError);
    expect(() => registerWorkflow(123, stubGraph())).toThrow(TypeError);
  });

  it('graph 缺 invoke 抛 TypeError', () => {
    expect(() => registerWorkflow('x', null)).toThrow(TypeError);
    expect(() => registerWorkflow('x', {})).toThrow(TypeError);
    expect(() => registerWorkflow('x', { invoke: 'not-a-function' })).toThrow(TypeError);
  });

  it('getWorkflow 未注册抛 "workflow not found"', () => {
    expect(() => getWorkflow('nonexistent')).toThrow(/workflow not found: nonexistent/);
  });

  it('_clearRegistryForTests 清空全部', () => {
    registerWorkflow('a', stubGraph());
    registerWorkflow('b', stubGraph());
    expect(listWorkflows()).toHaveLength(2);
    _clearRegistryForTests();
    expect(listWorkflows()).toEqual([]);
    expect(() => getWorkflow('a')).toThrow(/workflow not found/);
  });
});
