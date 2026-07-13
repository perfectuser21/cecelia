import { describe, it, expect } from 'vitest';
import { groupByStatus, AdvancementItem } from '../advancement-util';

const mk = (status: AdvancementItem['status'], id: string): AdvancementItem =>
  ({ id, title: id, status });

describe('groupByStatus', () => {
  it('空列表 pct=0', () => {
    const g = groupByStatus([]);
    expect(g).toEqual({ done: [], doing: [], todo: [], total: 0, pct: 0 });
  });
  it('混合列表分栏 + pct', () => {
    const g = groupByStatus([mk('done','a'), mk('todo','b'), mk('todo','c'), mk('doing','d')]);
    expect(g.done).toHaveLength(1);
    expect(g.doing).toHaveLength(1);
    expect(g.todo).toHaveLength(2);
    expect(g.total).toBe(4);
    expect(g.pct).toBe(25);
  });
  it('全 done pct=100', () => {
    expect(groupByStatus([mk('done','a'), mk('done','b')]).pct).toBe(100);
  });
});
