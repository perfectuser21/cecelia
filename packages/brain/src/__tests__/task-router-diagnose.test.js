/**
 * Tests for task-router diagnoseKR function
 * and enhanced routeTaskCreate logging
 */

import { describe, it, expect, vi } from 'vitest';
import { diagnoseKR, routeTaskCreate, SKILL_WHITELIST } from '../task-router.js';

// ==================== routeTaskCreate enhanced logging ====================

describe('routeTaskCreate - enhanced logging', () => {
  it('returns skill field in routing result', () => {
    const result = routeTaskCreate({ title: 'fix bug', task_type: 'dev' });
    expect(result).toHaveProperty('skill');
    expect(result.skill).toBe('/dev');
  });

  it('includes all context fields in result', () => {
    const result = routeTaskCreate({
      title: 'implement feature',
      task_type: 'dev',
      kr_id: 'kr-001',
      initiative_id: 'init-001'
    });
    expect(result.location).toBe('us');
    expect(result.task_type).toBe('dev');
    expect(result.skill).toBe('/dev');
    expect(result.execution_mode).toBeDefined();
  });

  it('handles missing optional context fields gracefully', () => {
    const result = routeTaskCreate({ task_type: 'review' });
    expect(result.skill).toBe('/code-review');
    expect(result.location).toBe('us');
  });

  it('uses default task_type=dev when not provided', () => {
    const result = routeTaskCreate({ title: 'some task' });
    expect(result.task_type).toBe('dev');
    expect(result.skill).toBe('/dev');
  });
});

// ==================== diagnoseKR ====================

describe('diagnoseKR', () => {
  // Helper: create a mock pool
  function createMockPool(mockResponses) {
    let callIndex = 0;
    return {
      query: vi.fn(async (sql) => {
        const response = mockResponses[callIndex++];
        if (response === undefined) {
          throw new Error(`Unexpected query #${callIndex}: ${sql.trim().substring(0, 80)}`);
        }
        return response;
      })
    };
  }

  it('returns null when KR not found', async () => {
    const pool = createMockPool([
      { rows: [] } // KR query returns empty
    ]);

    const result = await diagnoseKR('nonexistent-kr', pool);
    expect(result).toBeNull();
  });

  it('returns diagnosis with healthy status when no blockers', async () => {
    const pool = createMockPool([
      // 1. KR query
      { rows: [{ id: 'kr-001', title: 'Test KR', status: 'in_progress', priority: 'P0', progress: 50 }] },
      // 2. Projects query
      { rows: [{ id: 'proj-001', name: 'Test Project', status: 'active', type: 'project', created_at: new Date() }] },
      // 3. Initiatives query for project proj-001
      { rows: [
        {
          id: 'init-001',
          name: 'Test Initiative',
          status: 'active',
          created_at: new Date(),
          task_count: '2',
          active_task_count: '1',
          completed_task_count: '1',
          failed_task_count: '0'
        }
      ]},
      // 4. Tasks query for initiative init-001
      { rows: [
        { id: 'task-001', title: 'Implement feature', task_type: 'dev', status: 'queued', priority: 'P1', created_at: new Date(), updated_at: new Date() }
      ]}
    ]);

    const result = await diagnoseKR('kr-001', pool);

    expect(result).not.toBeNull();
    expect(result.kr_id).toBe('kr-001');
    expect(result.kr_title).toBe('Test KR');
    expect(result.summary.diagnosis).toBe('healthy');
    expect(result.summary.dispatch_blocker_count).toBe(0);
    expect(result.dispatch_blockers).toHaveLength(0);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].initiatives).toHaveLength(1);
    expect(result.projects[0].initiatives[0].tasks).toHaveLength(1);
  });

  it('detects no_tasks_created blocker for active initiative with 0 tasks', async () => {
    const pool = createMockPool([
      // 1. KR query
      { rows: [{ id: 'kr-002', title: 'KR with blocker', status: 'in_progress', priority: 'P1', progress: 0 }] },
      // 2. Projects query
      { rows: [{ id: 'proj-002', name: 'Project B', status: 'active', type: 'project', created_at: new Date() }] },
      // 3. Initiatives query for project proj-002
      { rows: [
        {
          id: 'init-002',
          name: 'Blocked Initiative',
          status: 'active',
          created_at: new Date(),
          task_count: '0',
          active_task_count: '0',
          completed_task_count: '0',
          failed_task_count: '0'
        }
      ]},
      // 4. Tasks query for initiative init-002
      { rows: [] }
    ]);

    const result = await diagnoseKR('kr-002', pool);

    expect(result.summary.diagnosis).toBe('blocked');
    expect(result.summary.dispatch_blocker_count).toBe(1);
    expect(result.dispatch_blockers[0].reason).toBe('no_tasks_created');
    expect(result.dispatch_blockers[0].initiative_id).toBe('init-002');
  });

  it('detects all_tasks_completed_initiative_still_active blocker', async () => {
    const pool = createMockPool([
      { rows: [{ id: 'kr-003', title: 'KR completed', status: 'in_progress', priority: 'P1', progress: 80 }] },
      { rows: [{ id: 'proj-003', name: 'Project C', status: 'active', type: 'project', created_at: new Date() }] },
      { rows: [
        {
          id: 'init-003',
          name: 'All Done Initiative',
          status: 'active',
          created_at: new Date(),
          task_count: '3',
          active_task_count: '0',
          completed_task_count: '3',
          failed_task_count: '0'
        }
      ]},
      { rows: [] }
    ]);

    const result = await diagnoseKR('kr-003', pool);

    expect(result.summary.diagnosis).toBe('blocked');
    expect(result.dispatch_blockers[0].reason).toBe('all_tasks_completed_initiative_still_active');
  });

  it('detects all_tasks_failed blocker', async () => {
    const pool = createMockPool([
      { rows: [{ id: 'kr-004', title: 'KR failed', status: 'in_progress', priority: 'P1', progress: 0 }] },
      { rows: [{ id: 'proj-004', name: 'Project D', status: 'active', type: 'project', created_at: new Date() }] },
      { rows: [
        {
          id: 'init-004',
          name: 'Failed Initiative',
          status: 'active',
          created_at: new Date(),
          task_count: '2',
          active_task_count: '0',
          completed_task_count: '0',
          failed_task_count: '2'
        }
      ]},
      { rows: [] }
    ]);

    const result = await diagnoseKR('kr-004', pool);

    expect(result.summary.diagnosis).toBe('blocked');
    expect(result.dispatch_blockers[0].reason).toBe('all_tasks_failed');
  });

  it('detects no_initiatives blocker for active project with no initiatives', async () => {
    const pool = createMockPool([
      { rows: [{ id: 'kr-005', title: 'KR no init', status: 'in_progress', priority: 'P1', progress: 0 }] },
      { rows: [{ id: 'proj-005', name: 'Project E', status: 'active', type: 'project', created_at: new Date() }] },
      // No initiatives for this project
      { rows: [] },
    ]);

    const result = await diagnoseKR('kr-005', pool);

    expect(result.summary.diagnosis).toBe('blocked');
    expect(result.dispatch_blockers[0].reason).toBe('no_initiatives');
    expect(result.dispatch_blockers[0].project_id).toBe('proj-005');
  });

  it('returns correct summary counts', async () => {
    const pool = createMockPool([
      { rows: [{ id: 'kr-006', title: 'KR summary', status: 'in_progress', priority: 'P1', progress: 30 }] },
      { rows: [
        { id: 'proj-006', name: 'Project F', status: 'active', type: 'project', created_at: new Date() }
      ]},
      { rows: [
        { id: 'init-006a', name: 'Init A', status: 'active', created_at: new Date(), task_count: '1', active_task_count: '1', completed_task_count: '0', failed_task_count: '0' },
        { id: 'init-006b', name: 'Init B', status: 'active', created_at: new Date(), task_count: '0', active_task_count: '0', completed_task_count: '0', failed_task_count: '0' }
      ]},
      { rows: [] }, // tasks for init-006a
      { rows: [] }  // tasks for init-006b
    ]);

    const result = await diagnoseKR('kr-006', pool);

    expect(result.summary.total_projects).toBe(1);
    expect(result.summary.total_initiatives).toBe(2);
    expect(result.summary.active_initiatives).toBe(2);
    expect(result.summary.initiatives_with_active_tasks).toBe(1);
    expect(result.summary.dispatch_blocker_count).toBe(1); // init-006b has no tasks
  });

  it('includes routing info for each task', async () => {
    const pool = createMockPool([
      { rows: [{ id: 'kr-007', title: 'KR routing', status: 'in_progress', priority: 'P0', progress: 20 }] },
      { rows: [{ id: 'proj-007', name: 'Project G', status: 'active', type: 'project', created_at: new Date() }] },
      { rows: [
        { id: 'init-007', name: 'Init G', status: 'active', created_at: new Date(), task_count: '1', active_task_count: '1', completed_task_count: '0', failed_task_count: '0' }
      ]},
      { rows: [
        { id: 'task-007', title: 'Write tests', task_type: 'qa', status: 'queued', priority: 'P1', created_at: new Date(), updated_at: new Date() }
      ]}
    ]);

    const result = await diagnoseKR('kr-007', pool);

    const initiative = result.projects[0].initiatives[0];
    expect(initiative.tasks).toHaveLength(1);
    const task = initiative.tasks[0];
    expect(task.routing).toBeDefined();
    expect(task.routing.location).toBe('us');  // qa → us
    expect(task.routing.skill).toBe('/code-review');  // qa → /code-review
  });

  it('handles KR with no projects (empty project list)', async () => {
    const pool = createMockPool([
      { rows: [{ id: 'kr-008', title: 'KR empty', status: 'in_progress', priority: 'P2', progress: 0 }] },
      { rows: [] } // no projects
    ]);

    const result = await diagnoseKR('kr-008', pool);

    expect(result).not.toBeNull();
    expect(result.summary.total_projects).toBe(0);
    expect(result.summary.total_initiatives).toBe(0);
    expect(result.summary.diagnosis).toBe('healthy'); // no blockers if no projects
    expect(result.dispatch_blockers).toHaveLength(0);
  });
});
