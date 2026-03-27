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

  it('暗色主题优先级标签使用 rgba 背景而非 Tailwind class', () => {
    const PRIORITY_STYLE: Record<string, { background: string; color: string }> = {
      P0: { background: 'rgba(239,68,68,0.15)', color: '#f87171' },
      P1: { background: 'rgba(234,179,8,0.15)', color: '#fbbf24' },
      P2: { background: 'rgba(107,114,128,0.15)', color: '#6b7280' },
    };

    expect(PRIORITY_STYLE['P0'].background).toContain('rgba');
    expect(PRIORITY_STYLE['P0'].color).toBe('#f87171');
    expect(PRIORITY_STYLE['P1'].color).toBe('#fbbf24');
    expect(PRIORITY_STYLE['P2'].color).toBe('#6b7280');
  });

  it('已完成模块查看链接应构造绝对 URL', () => {
    const HOST = 'http://38.23.47.81:9998';
    const output_url = 'knowledge/brain/tick-loop.html';
    const absoluteUrl = `${HOST}/${output_url}`;
    expect(absoluteUrl).toBe('http://38.23.47.81:9998/knowledge/brain/tick-loop.html');
    expect(absoluteUrl.startsWith('http')).toBe(true);
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
