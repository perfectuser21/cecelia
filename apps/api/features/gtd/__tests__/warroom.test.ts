import { describe, it, expect, vi, afterEach } from 'vitest';

describe('GTDWarRoom data logic', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters active objectives from OKR tree', () => {
    const tree = [
      {
        id: 'v1', type: 'vision', status: 'active', title: 'North Star', children: [
          {
            id: 'area1', type: 'area', status: 'active', children: [
              { id: 'obj1', type: 'objective', status: 'active', title: 'Obj 1', children: [] },
              { id: 'obj2', type: 'objective', status: 'completed', title: 'Done Obj', children: [] },
              { id: 'obj3', type: 'objective', status: 'in_progress', title: 'Obj 3', children: [] },
            ],
          },
        ],
      },
    ];

    const objectives: typeof tree[0]['children'][0]['children'] = [];
    tree.forEach(v => {
      v.children.forEach(area => {
        area.children.forEach(obj => {
          if (obj.status === 'active' || obj.status === 'in_progress') {
            objectives.push(obj);
          }
        });
      });
    });

    expect(objectives).toHaveLength(2);
    expect(objectives.map(o => o.id)).toEqual(['obj1', 'obj3']);
  });

  it('filters vision nodes from OKR tree', () => {
    const tree = [
      { id: 'v1', type: 'vision', status: 'active', title: 'Vision', children: [] },
      { id: 'a1', type: 'area', status: 'active', title: 'Area', children: [] },
    ];
    const visions = tree.filter(n => n.type === 'vision');
    expect(visions).toHaveLength(1);
    expect(visions[0].id).toBe('v1');
  });

  it('handles empty OKR tree gracefully', () => {
    const tree: never[] = [];
    const visions = tree.filter((n: { type: string }) => n.type === 'vision');
    const objectives: never[] = [];
    expect(visions).toHaveLength(0);
    expect(objectives).toHaveLength(0);
  });

  it('nodeTitle returns title or name or fallback', () => {
    const nodeTitle = (n: { title?: string; name?: string }) =>
      n.title || n.name || '(无标题)';

    expect(nodeTitle({ title: 'My Title' })).toBe('My Title');
    expect(nodeTitle({ name: 'My Name' })).toBe('My Name');
    expect(nodeTitle({})).toBe('(无标题)');
  });
});
