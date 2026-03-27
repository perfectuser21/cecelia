import { describe, it, expect } from 'vitest';
import { toAreaSlug, buildAreaSummaries } from '../pages/GTDWarRoom';

describe('toAreaSlug', () => {
  it('converts simple name to slug', () => {
    expect(toAreaSlug('Cecelia')).toBe('cecelia');
  });

  it('converts CamelCase to kebab-case', () => {
    expect(toAreaSlug('ZenithJoy')).toBe('zenith-joy');
  });

  it('converts space-separated name to slug', () => {
    expect(toAreaSlug('Stock Investment')).toBe('stock-investment');
  });

  it('handles already lowercase name', () => {
    expect(toAreaSlug('cecelia')).toBe('cecelia');
  });

  it('collapses multiple separators', () => {
    expect(toAreaSlug('AI  Systems')).toBe('a-i-systems');
  });
});

describe('buildAreaSummaries', () => {
  const sampleTree = [
    {
      id: 'v1',
      type: 'vision',
      status: 'active',
      title: 'North Star',
      description: null,
      children: [
        {
          id: 'area1',
          type: 'area',
          status: 'active',
          title: 'Cecelia',
          children: [
            {
              id: 'obj1',
              type: 'objective',
              status: 'active',
              title: 'Obj 1',
              children: [
                { id: 'kr1', type: 'kr', status: 'active', title: 'KR 1', children: [] },
                { id: 'kr2', type: 'kr', status: 'completed', title: 'KR 2', children: [] },
              ],
            },
          ],
        },
        {
          id: 'area2',
          type: 'area',
          status: 'active',
          title: 'ZenithJoy',
          children: [
            {
              id: 'obj2',
              type: 'objective',
              status: 'in_progress',
              title: 'Obj 2',
              children: [],
            },
          ],
        },
        {
          id: 'area3',
          type: 'area',
          status: 'active',
          title: 'Empty Area',
          children: [],
        },
      ],
    },
  ];

  it('returns active vision and area summaries', () => {
    const { vision, areas } = buildAreaSummaries(sampleTree);
    expect(vision).not.toBeNull();
    expect(vision?.id).toBe('v1');
    expect(areas).toHaveLength(2); // Empty Area excluded (no active OBJ)
  });

  it('counts active objectives correctly', () => {
    const { areas } = buildAreaSummaries(sampleTree);
    const cecelia = areas.find(a => a.title === 'Cecelia');
    expect(cecelia?.activeObjCount).toBe(1);
  });

  it('counts KR correctly', () => {
    const { areas } = buildAreaSummaries(sampleTree);
    const cecelia = areas.find(a => a.title === 'Cecelia');
    expect(cecelia?.totalKrCount).toBe(2);
    expect(cecelia?.completedKrCount).toBe(1);
  });

  it('generates correct slugs for areas', () => {
    const { areas } = buildAreaSummaries(sampleTree);
    const cecelia = areas.find(a => a.title === 'Cecelia');
    const zenith = areas.find(a => a.title === 'ZenithJoy');
    expect(cecelia?.slug).toBe('cecelia');
    expect(zenith?.slug).toBe('zenith-joy');
  });

  it('excludes areas with no active objectives', () => {
    const { areas } = buildAreaSummaries(sampleTree);
    expect(areas.find(a => a.title === 'Empty Area')).toBeUndefined();
  });

  it('returns null vision when no active vision found', () => {
    const { vision, areas } = buildAreaSummaries([]);
    expect(vision).toBeNull();
    expect(areas).toHaveLength(0);
  });

  it('returns null vision when active vision has no children', () => {
    const tree = [{ id: 'v1', type: 'vision', status: 'active', title: 'V', children: [] }];
    const { vision } = buildAreaSummaries(tree);
    expect(vision).toBeNull();
  });
});
