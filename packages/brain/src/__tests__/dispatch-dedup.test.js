// packages/brain/src/__tests__/dispatch-dedup.test.js
import { describe, it, expect } from 'vitest';
import { titleSimilarity, findDuplicateSibling } from '../dispatch-dedup.js';

describe('titleSimilarity', () => {
  it('高重叠标题返回高相似度', () => {
    const a = 'feat(brain): skill-eval-worker 常驻 daemon + running 超时回收';
    const b = 'feat(brain): skill-eval-worker 常驻 daemon + running 超时回收 + pm2 ecosystem';
    expect(titleSimilarity(a, b)).toBeGreaterThan(0.6);
  });

  it('无关标题返回低相似度', () => {
    const a = 'feat(brain): skill-eval-worker 常驻 daemon';
    const b = 'fix(dashboard): 修复登录页样式错位';
    expect(titleSimilarity(a, b)).toBeLessThan(0.3);
  });

  it('完全相同标题返回 1', () => {
    const a = '同一个标题';
    expect(titleSimilarity(a, a)).toBe(1);
  });

  it('空字符串不抛错，返回 0', () => {
    expect(titleSimilarity('', 'abc')).toBe(0);
    expect(titleSimilarity('', '')).toBe(0);
  });
});

describe('findDuplicateSibling', () => {
  it('命中阈值以上的候选，返回该候选', () => {
    const title = 'skill-eval-worker 常驻 daemon + running 超时回收';
    const siblings = [
      { id: 'a', title: '无关任务' },
      { id: 'b', title: 'skill-eval-worker 常驻 daemon + running 超时回收 + pm2 ecosystem' },
    ];
    const hit = findDuplicateSibling(title, siblings, { threshold: 0.6, keyFn: (s) => s.title });
    expect(hit).not.toBeNull();
    expect(hit.id).toBe('b');
  });

  it('无命中时返回 null', () => {
    const title = 'skill-eval-worker 常驻 daemon';
    const siblings = [{ id: 'a', title: '完全无关的标题内容' }];
    const hit = findDuplicateSibling(title, siblings, { threshold: 0.6, keyFn: (s) => s.title });
    expect(hit).toBeNull();
  });

  it('siblings 为空数组返回 null', () => {
    expect(findDuplicateSibling('any title', [], { threshold: 0.6, keyFn: (s) => s.title })).toBeNull();
  });

  it('candidates 传 null/undefined 时返回 null（不抛错）', () => {
    expect(findDuplicateSibling('any title', null, { threshold: 0.6, keyFn: (s) => s.title })).toBeNull();
    expect(findDuplicateSibling('any title', undefined, { threshold: 0.6, keyFn: (s) => s.title })).toBeNull();
  });

  it('缺少 keyFn 时抛出明确错误', () => {
    expect(() => findDuplicateSibling('any title', [{ title: 'x' }], { threshold: 0.6 })).toThrow(/keyFn/);
  });
});
