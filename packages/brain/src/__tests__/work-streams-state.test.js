import { describe, it, expect, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query } }));
import { getGlobalState, selectTopAreas, selectActiveInitiativeForArea } from '../planner.js';

describe('work streams state', () => {
  it('renders active work from the read model without needing planning history', async () => {
    const fixtures = [
      [{ id: 'area', type: 'vision', status: 'active', priority: 'P0' }],
      [{ id: 'kr', parent_id: 'area', status: 'ready', title: 'Delivery' }],
      [
        { id: 'older', created_at: '2026-01-01', status: 'active' },
        { id: 'running', created_at: '2026-02-01', status: 'in_progress' },
      ],
      [
        { id: 'queued', goal_id: 'kr', project_id: 'older', status: 'queued' },
        { id: 'active', goal_id: 'kr', project_id: 'running', status: 'in_progress' },
      ],
    ];
    let next = 0;
    query.mockImplementation(async (sql) => {
      if (!/^\s*SELECT\b/i.test(sql)) throw new Error('Read-only connection');
      if (next >= fixtures.length) throw new Error('Planning history is unavailable');
      return { rows: fixtures[next++] };
    });
    const state = await getGlobalState();
    const areas = selectTopAreas(state, 3);
    expect(areas.map(area => area.id)).toEqual(['area']);
    const selected = selectActiveInitiativeForArea(areas[0], state);
    expect(selected.initiative.id).toBe('running');
    expect(selected.kr.title).toBe('Delivery');
  });
});
