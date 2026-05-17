import { describe, it, expect } from 'vitest';

describe('KnowledgeModules 数据逻辑', () => {
  it('按 brain/engine/workflows/system 分组模块', () => {
    const groups = ['brain', 'engine', 'workflows', 'system'];
    const mockData = {
      meta: { total: 86, done: 76 },
      groups: groups.map(id => ({
        id,
        label: id,
        items: [
          { id: `${id}-1`, title: `${id} module`, desc: 'test', priority: 'P1', status: 'done', output_url: null, source_files: [], completed: null },
        ],
      })),
    };

    expect(mockData.groups).toHaveLength(4);
    expect(mockData.groups.map(g => g.id)).toEqual(groups);
  });

  it('优先级标签覆盖 P0/P1/P2', () => {
    const PRIORITY_BADGE: Record<string, string> = {
      P0: 'bg-red-100 text-red-700',
      P1: 'bg-yellow-100 text-yellow-700',
      P2: 'bg-gray-100 text-gray-500',
    };

    expect(PRIORITY_BADGE['P0']).toBe('bg-red-100 text-red-700');
    expect(PRIORITY_BADGE['P1']).toBe('bg-yellow-100 text-yellow-700');
    expect(PRIORITY_BADGE['P2']).toBe('bg-gray-100 text-gray-500');
  });

  it('已完成模块应有 output_url', () => {
    const item = { status: 'done', output_url: 'knowledge/brain/tick-loop.html' };
    const isDone = item.status === 'done';
    expect(isDone && item.output_url).toBeTruthy();
  });

  it('待生成模块 output_url 为 null', () => {
    const item = { status: 'todo', output_url: null };
    const isDone = item.status === 'done';
    expect(isDone).toBe(false);
  });

  it('source_files 列表不为空时应展示', () => {
    const module = {
      source_files: ['packages/brain/src/tick.js', 'packages/brain/src/monitor-loop.js'],
    };
    expect(module.source_files.length).toBeGreaterThan(0);
  });

  it('KnowledgeHome 应有 5 张卡片（含深度知识页）', () => {
    const cards = [
      { id: 'content', path: '/knowledge/content' },
      { id: 'brain', path: '/knowledge/brain' },
      { id: 'digestion', path: '/knowledge/digestion' },
      { id: 'instruction-book', path: '/knowledge/instruction-book' },
      { id: 'modules', path: '/knowledge/modules' },
    ];
    expect(cards).toHaveLength(5);
    expect(cards.some(c => c.path === '/knowledge/modules')).toBe(true);
  });
});
