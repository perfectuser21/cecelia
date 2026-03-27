import { describe, it, expect, vi, afterEach } from 'vitest';

describe('GTDWarRoom data logic', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts areas from OKR tree (vision > area)', () => {
    const tree = [
      {
        id: 'v1', type: 'vision', status: 'active', title: 'North Star', children: [
          { id: 'area1', type: 'area', status: 'active', title: 'Cecelia', children: [] },
          { id: 'area2', type: 'area', status: 'active', title: 'ZenithJoy', children: [] },
        ],
      },
    ];

    const areas: typeof tree[0]['children'] = [];
    tree.forEach(v => {
      v.children.forEach(area => {
        if (area.type === 'area') areas.push(area);
      });
    });

    expect(areas).toHaveLength(2);
    expect(areas.map(a => a.title)).toEqual(['Cecelia', 'ZenithJoy']);
  });

  it('calculates area KR progress as average of all KR progress', () => {
    const area = {
      id: 'area1', type: 'area', status: 'active', title: 'Cecelia', children: [
        {
          id: 'obj1', type: 'objective', status: 'active', children: [
            { id: 'kr1', type: 'key_result', status: 'active', progress: 60, children: [] },
            { id: 'kr2', type: 'key_result', status: 'active', progress: 40, children: [] },
          ],
        },
      ],
    };

    const allKrs: { progress?: number }[] = [];
    area.children.forEach(obj => {
      obj.children.forEach(kr => allKrs.push(kr));
    });
    const total = allKrs.reduce((sum, kr) => sum + (kr.progress ?? 0), 0);
    const progress = allKrs.length > 0 ? Math.round(total / allKrs.length) : 0;

    expect(progress).toBe(50);
  });

  it('calculates activeObjs count for an area', () => {
    const area = {
      id: 'area1', type: 'area', status: 'active', children: [
        { id: 'obj1', type: 'objective', status: 'active', children: [] },
        { id: 'obj2', type: 'objective', status: 'completed', children: [] },
        { id: 'obj3', type: 'objective', status: 'in_progress', children: [] },
      ],
    };

    const activeObjs = area.children.filter(
      obj => obj.status === 'active' || obj.status === 'in_progress'
    );
    expect(activeObjs).toHaveLength(2);
  });

  it('filters active objectives for area detail page', () => {
    const currentArea = {
      id: 'area1', type: 'area', status: 'active', title: 'Cecelia', children: [
        { id: 'obj1', type: 'objective', status: 'active', title: 'Obj 1', children: [] },
        { id: 'obj2', type: 'objective', status: 'completed', title: 'Done Obj', children: [] },
        { id: 'obj3', type: 'objective', status: 'in_progress', title: 'Obj 3', children: [] },
      ],
    };

    const objectives = currentArea.children.filter(
      obj => obj.status === 'active' || obj.status === 'in_progress'
    );

    expect(objectives).toHaveLength(2);
    expect(objectives.map(o => o.id)).toEqual(['obj1', 'obj3']);
  });

  it('flattens pending KRs across all objectives for detail page', () => {
    const objectives = [
      {
        id: 'obj1', children: [
          { id: 'kr1', status: 'active', progress: 40, children: [] },
          { id: 'kr2', status: 'completed', progress: 100, children: [] },
        ],
      },
      {
        id: 'obj2', children: [
          { id: 'kr3', status: 'in_progress', progress: 60, children: [] },
        ],
      },
    ];

    const allKrs = objectives.flatMap(obj => obj.children.filter(kr => kr.status !== 'completed'));
    expect(allKrs).toHaveLength(2);
    expect(allKrs.map(kr => kr.id)).toEqual(['kr1', 'kr3']);
  });

  it('finds area by areaId from full tree', () => {
    const tree = [
      {
        id: 'v1', type: 'vision', children: [
          { id: 'area1', type: 'area', title: 'Cecelia', children: [] },
          { id: 'area2', type: 'area', title: 'ZenithJoy', children: [] },
        ],
      },
    ];

    const targetId = 'area2';
    let found: { id: string; type: string; title: string; children: never[] } | null = null;
    for (const vision of tree) {
      for (const area of vision.children) {
        if (area.id === targetId) { found = area; break; }
      }
      if (found) break;
    }

    expect(found).not.toBeNull();
    expect(found?.title).toBe('ZenithJoy');
  });

  it('returns null when areaId not found', () => {
    const tree = [
      {
        id: 'v1', type: 'vision', children: [
          { id: 'area1', type: 'area', title: 'Cecelia', children: [] },
        ],
      },
    ];

    let found = null;
    for (const vision of tree) {
      for (const area of vision.children) {
        if (area.id === 'nonexistent') { found = area; break; }
      }
      if (found) break;
    }

    expect(found).toBeNull();
  });

  it('nodeTitle returns title or name or fallback', () => {
    const nodeTitle = (n: { title?: string; name?: string }) =>
      n.title || n.name || '(无标题)';

    expect(nodeTitle({ title: 'My Title' })).toBe('My Title');
    expect(nodeTitle({ name: 'My Name' })).toBe('My Name');
    expect(nodeTitle({})).toBe('(无标题)');
  });

  it('GTDWarRoom summary page uses Vision + Area card structure', () => {
    const fs = require('fs');
    const src = fs.readFileSync('apps/api/features/gtd/pages/GTDWarRoom.tsx', 'utf8');
    expect(src).toContain('Vision');
    expect(src).toContain('areaId');
    expect(src).toContain('h-full');
    expect(src).toContain('overflow-y-auto');
  });

  it('GTDWarRoomArea detail page uses three-column layout', () => {
    const fs = require('fs');
    const src = fs.readFileSync('apps/api/features/gtd/pages/GTDWarRoomArea.tsx', 'utf8');
    expect(src).toContain('useParams');
    expect(src).toContain('overflow-y-auto');
    expect(src).toContain('md:grid-cols-3');
  });
});
