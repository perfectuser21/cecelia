// Sprint 1 Phase B/C 全图重构 — harness-utils.js 单元测试
// 覆盖 topologicalLayers / buildGeneratorPrompt / extractWorkstreamIndex

import { describe, it, expect } from 'vitest';
import { topologicalLayers, buildGeneratorPrompt, extractWorkstreamIndex } from '../harness-utils.js';

describe('topologicalLayers', () => {
  it('扁平 DAG（无依赖） → 1 层', () => {
    const tasks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(topologicalLayers(tasks)).toEqual([['a', 'b', 'c']]);
  });
  it('链式依赖 → N 层', () => {
    const tasks = [
      { id: 'a' },
      { id: 'b', depends_on: ['a'] },
      { id: 'c', depends_on: ['b'] },
    ];
    expect(topologicalLayers(tasks)).toEqual([['a'], ['b'], ['c']]);
  });
  it('钻石依赖', () => {
    const tasks = [
      { id: 'a' },
      { id: 'b', depends_on: ['a'] },
      { id: 'c', depends_on: ['a'] },
      { id: 'd', depends_on: ['b', 'c'] },
    ];
    const layers = topologicalLayers(tasks);
    expect(layers[0]).toEqual(['a']);
    expect(layers[1].sort()).toEqual(['b', 'c']);
    expect(layers[2]).toEqual(['d']);
  });
  it('循环依赖 → 抛错', () => {
    const tasks = [
      { id: 'a', depends_on: ['b'] },
      { id: 'b', depends_on: ['a'] },
    ];
    expect(() => topologicalLayers(tasks)).toThrow(/cycle/i);
  });
  it('空数组 → []', () => {
    expect(topologicalLayers([])).toEqual([]);
  });
});

describe('buildGeneratorPrompt', () => {
  it('普通模式 inline SKILL pattern (Bug 7 fix) + 含 task_id / DoD / files', () => {
    const p = buildGeneratorPrompt(
      { id: 't1', title: 'T', description: 'D', payload: { dod: ['x'], files: ['f.js'], parent_task_id: 'init' } },
      { fixMode: false }
    );
    // Bug 7 修复：第一行是 inline agent 引导，不是 slash command
    expect(p.split('\n')[0]).toBe('你是 harness-generator agent。按下面 SKILL 指令工作。');
    // SKILL v6.1 真注入了（Step 6.5 Contract Self-Verification 关键词必有）
    expect(p).toContain('Contract Self-Verification');
    // 任务数据仍嵌入
    expect(p).toContain('task_id: t1');
    expect(p).toContain('fix_mode: false');
    expect(p).toContain('- x');
    expect(p).toContain('- f.js');
  });
  it('fix mode inline pattern + 任务段含 (FIX mode) 标记', () => {
    const p = buildGeneratorPrompt({ id: 't1', payload: {} }, { fixMode: true });
    expect(p.split('\n')[0]).toBe('你是 harness-generator agent。按下面 SKILL 指令工作。');
    expect(p).toContain('FIX mode');
    expect(p).toContain('fix_mode: true');
    // SKILL v6.1 Step 6.5 关键词必有
    expect(p).toContain('Contract Self-Verification');
  });
});

describe('extractWorkstreamIndex', () => {
  it('payload.workstream_index 数字优先', () => {
    expect(extractWorkstreamIndex({ workstream_index: 3 })).toBe('3');
  });
  it('logical_task_id ws<N> 解析', () => {
    expect(extractWorkstreamIndex({ logical_task_id: 'ws7' })).toBe('7');
  });
  it('找不到返回空串', () => {
    expect(extractWorkstreamIndex({})).toBe('');
  });
});
