/**
 * Area Stream Dispatch Tests
 * Tests for selectTopAreas and selectActiveInitiativeForArea (pure functions)
 */

import { describe, it, expect } from 'vitest';
import { selectTopAreas, selectActiveInitiativeForArea } from '../planner.js';

// ============================================================
// selectTopAreas
// ============================================================

describe('selectTopAreas', () => {
  it('should return empty array when no area_okr objectives', () => {
    const state = {
      objectives: [],
      keyResults: [],
      activeTasks: []
    };
    expect(selectTopAreas(state, 3)).toEqual([]);
  });

  it('should return empty array when areas have no queued tasks', () => {
    const state = {
      objectives: [
        { id: 'area-1', type: 'area_okr', priority: 'P0', status: 'active' }
      ],
      keyResults: [
        { id: 'kr-1', parent_id: 'area-1', status: 'ready' }
      ],
      activeTasks: [] // no queued tasks
    };
    expect(selectTopAreas(state, 3)).toEqual([]);
  });

  it('should only return areas with queued tasks', () => {
    const state = {
      objectives: [
        { id: 'area-1', type: 'area_okr', priority: 'P1', status: 'active' },
        { id: 'area-2', type: 'area_okr', priority: 'P1', status: 'active' }
      ],
      keyResults: [
        { id: 'kr-1', parent_id: 'area-1', status: 'ready' },
        { id: 'kr-2', parent_id: 'area-2', status: 'ready' }
      ],
      activeTasks: [
        { id: 't-1', status: 'queued', goal_id: 'kr-1', project_id: 'init-1' }
        // area-2 has no tasks
      ]
    };
    const result = selectTopAreas(state, 3);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('area-1');
  });

  it('should prefer P0 area over P1', () => {
    const state = {
      objectives: [
        { id: 'area-p1', type: 'area_okr', priority: 'P1', status: 'active' },
        { id: 'area-p0', type: 'area_okr', priority: 'P0', status: 'active' }
      ],
      keyResults: [
        { id: 'kr-p1', parent_id: 'area-p1', status: 'ready' },
        { id: 'kr-p0', parent_id: 'area-p0', status: 'ready' }
      ],
      activeTasks: [
        { id: 't-1', status: 'queued', goal_id: 'kr-p1', project_id: 'init-1' },
        { id: 't-2', status: 'queued', goal_id: 'kr-p0', project_id: 'init-2' }
      ]
    };
    const result = selectTopAreas(state, 3);
    expect(result[0].id).toBe('area-p0');
  });

  it('should respect count limit', () => {
    const state = {
      objectives: [
        { id: 'area-1', type: 'area_okr', priority: 'P1', status: 'active' },
        { id: 'area-2', type: 'area_okr', priority: 'P1', status: 'active' },
        { id: 'area-3', type: 'area_okr', priority: 'P1', status: 'active' }
      ],
      keyResults: [
        { id: 'kr-1', parent_id: 'area-1', status: 'ready' },
        { id: 'kr-2', parent_id: 'area-2', status: 'ready' },
        { id: 'kr-3', parent_id: 'area-3', status: 'ready' }
      ],
      activeTasks: [
        { id: 't-1', status: 'queued', goal_id: 'kr-1', project_id: 'init-1' },
        { id: 't-2', status: 'queued', goal_id: 'kr-2', project_id: 'init-2' },
        { id: 't-3', status: 'queued', goal_id: 'kr-3', project_id: 'init-3' }
      ]
    };
    const result = selectTopAreas(state, 2);
    expect(result).toHaveLength(2);
  });

  it('should exclude completed and cancelled areas', () => {
    const state = {
      objectives: [
        { id: 'area-done', type: 'area_okr', priority: 'P0', status: 'completed' },
        { id: 'area-cancel', type: 'area_okr', priority: 'P0', status: 'cancelled' },
        { id: 'area-active', type: 'area_okr', priority: 'P1', status: 'active' }
      ],
      keyResults: [
        { id: 'kr-done', parent_id: 'area-done', status: 'ready' },
        { id: 'kr-cancel', parent_id: 'area-cancel', status: 'ready' },
        { id: 'kr-active', parent_id: 'area-active', status: 'ready' }
      ],
      activeTasks: [
        { id: 't-1', status: 'queued', goal_id: 'kr-done', project_id: 'init-1' },
        { id: 't-2', status: 'queued', goal_id: 'kr-cancel', project_id: 'init-2' },
        { id: 't-3', status: 'queued', goal_id: 'kr-active', project_id: 'init-3' }
      ]
    };
    const result = selectTopAreas(state, 3);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('area-active');
  });
});

// ============================================================
// selectActiveInitiativeForArea
// ============================================================

describe('selectActiveInitiativeForArea', () => {
  const area = { id: 'area-1', type: 'area_okr', priority: 'P1' };

  it('should return null when area has no KRs', () => {
    const state = {
      keyResults: [], // no KRs for this area
      activeTasks: [],
      projects: []
    };
    expect(selectActiveInitiativeForArea(area, state)).toBeNull();
  });

  it('should return null when no tasks for area KRs', () => {
    const state = {
      keyResults: [{ id: 'kr-1', parent_id: 'area-1' }],
      activeTasks: [], // no tasks
      projects: [{ id: 'init-1', type: 'initiative', created_at: '2026-01-01' }]
    };
    expect(selectActiveInitiativeForArea(area, state)).toBeNull();
  });

  it('should return initiative with in_progress task (Initiative Lock)', () => {
    const state = {
      keyResults: [{ id: 'kr-1', parent_id: 'area-1' }],
      activeTasks: [
        { id: 't-1', status: 'in_progress', goal_id: 'kr-1', project_id: 'init-locked' },
        { id: 't-2', status: 'queued', goal_id: 'kr-1', project_id: 'init-new' }
      ],
      projects: [
        { id: 'init-locked', type: 'initiative', name: 'Locked Init', created_at: '2026-01-02' },
        { id: 'init-new', type: 'initiative', name: 'New Init', created_at: '2026-01-01' }
      ]
    };
    const result = selectActiveInitiativeForArea(area, state);
    expect(result).not.toBeNull();
    expect(result.initiative.id).toBe('init-locked'); // Lock: in_progress wins even if older
    expect(result.kr.id).toBe('kr-1');
  });

  it('should return earliest queued initiative when no in_progress (FIFO)', () => {
    const state = {
      keyResults: [{ id: 'kr-1', parent_id: 'area-1' }],
      activeTasks: [
        { id: 't-1', status: 'queued', goal_id: 'kr-1', project_id: 'init-newer' },
        { id: 't-2', status: 'queued', goal_id: 'kr-1', project_id: 'init-older' }
      ],
      projects: [
        { id: 'init-newer', type: 'initiative', name: 'Newer', created_at: '2026-02-01' },
        { id: 'init-older', type: 'initiative', name: 'Older', created_at: '2026-01-01' }
      ]
    };
    const result = selectActiveInitiativeForArea(area, state);
    expect(result).not.toBeNull();
    expect(result.initiative.id).toBe('init-older'); // FIFO: oldest first
  });

  it('should ignore tasks from other areas', () => {
    const state = {
      keyResults: [
        { id: 'kr-1', parent_id: 'area-1' },
        { id: 'kr-other', parent_id: 'area-other' }
      ],
      activeTasks: [
        { id: 't-other', status: 'queued', goal_id: 'kr-other', project_id: 'init-other' }
        // no tasks for area-1 KRs
      ],
      projects: [
        { id: 'init-other', type: 'initiative', name: 'Other', created_at: '2026-01-01' }
      ]
    };
    expect(selectActiveInitiativeForArea(area, state)).toBeNull();
  });

  it('should handle multiple KRs under same area', () => {
    const state = {
      keyResults: [
        { id: 'kr-a', parent_id: 'area-1' },
        { id: 'kr-b', parent_id: 'area-1' }
      ],
      activeTasks: [
        { id: 't-1', status: 'in_progress', goal_id: 'kr-b', project_id: 'init-b' },
        { id: 't-2', status: 'queued', goal_id: 'kr-a', project_id: 'init-a' }
      ],
      projects: [
        { id: 'init-a', type: 'initiative', name: 'Init A', created_at: '2026-01-01' },
        { id: 'init-b', type: 'initiative', name: 'Init B', created_at: '2026-02-01' }
      ]
    };
    const result = selectActiveInitiativeForArea(area, state);
    expect(result.initiative.id).toBe('init-b'); // in_progress lock wins
    expect(result.kr.id).toBe('kr-b');
  });
});
