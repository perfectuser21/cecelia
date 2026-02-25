/**
 * Actions - createInitiative orchestration 支持测试
 *
 * DoD 覆盖: D4
 */

import { describe, it, expect, afterEach } from 'vitest';
import pool from '../db.js';
import { createInitiative } from '../actions.js';

let testProjectIds = [];

async function createTestProject() {
  const result = await pool.query(`
    INSERT INTO projects (name, type, status, description)
    VALUES ('Test Project for Initiative', 'project', 'active', 'test')
    RETURNING id
  `);
  testProjectIds.push(result.rows[0].id);
  return result.rows[0].id;
}

describe('createInitiative - orchestration support', () => {
  afterEach(async () => {
    // Clean up: initiatives first (they reference parent project)
    for (const pid of testProjectIds) {
      await pool.query('DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE parent_id = $1)', [pid]);
      await pool.query('DELETE FROM projects WHERE parent_id = $1', [pid]);
    }
    if (testProjectIds.length > 0) {
      await pool.query('DELETE FROM projects WHERE id = ANY($1)', [testProjectIds]);
      testProjectIds = [];
    }
  });

  it('D4: default execution_mode is simple', async () => {
    const parentId = await createTestProject();
    const result = await createInitiative({
      name: 'Simple Initiative',
      parent_id: parentId,
    });

    expect(result.success).toBe(true);
    expect(result.initiative.execution_mode).toBe('simple');
    expect(result.initiative.current_phase).toBeNull();
    expect(result.initiative.dod_content).toBeNull();
    testProjectIds.push(result.initiative.id);
  });

  it('D4: orchestrated initiative sets current_phase=plan', async () => {
    const parentId = await createTestProject();
    const result = await createInitiative({
      name: 'Orchestrated Initiative',
      parent_id: parentId,
      execution_mode: 'orchestrated',
    });

    expect(result.success).toBe(true);
    expect(result.initiative.execution_mode).toBe('orchestrated');
    expect(result.initiative.current_phase).toBe('plan');
    expect(result.initiative.status).toBe('active');
    testProjectIds.push(result.initiative.id);
  });

  it('D4: orchestrated initiative with dod_content', async () => {
    const parentId = await createTestProject();
    const dodContent = [
      { item: 'API 返回正确 JSON', pass_criteria: '200 + valid schema' },
      { item: '测试覆盖率 > 80%', pass_criteria: 'vitest coverage report' },
    ];

    const result = await createInitiative({
      name: 'Initiative with DoD',
      parent_id: parentId,
      execution_mode: 'orchestrated',
      dod_content: dodContent,
    });

    expect(result.success).toBe(true);
    expect(result.initiative.dod_content).toEqual(dodContent);
    testProjectIds.push(result.initiative.id);
  });

  it('D4: simple initiative ignores dod_content gracefully', async () => {
    const parentId = await createTestProject();
    const result = await createInitiative({
      name: 'Simple with DoD attempt',
      parent_id: parentId,
      execution_mode: 'simple',
      dod_content: [{ item: 'test' }],
    });

    expect(result.success).toBe(true);
    expect(result.initiative.execution_mode).toBe('simple');
    expect(result.initiative.current_phase).toBeNull();
    // dod_content is stored even for simple (no harm)
    expect(result.initiative.dod_content).toEqual([{ item: 'test' }]);
    testProjectIds.push(result.initiative.id);
  });

  it('D4: backward compat - no execution_mode defaults to simple', async () => {
    const parentId = await createTestProject();
    const result = await createInitiative({
      name: 'Legacy Initiative',
      parent_id: parentId,
      description: 'Created without execution_mode',
    });

    expect(result.success).toBe(true);
    expect(result.initiative.execution_mode).toBe('simple');
    expect(result.initiative.current_phase).toBeNull();
    expect(result.initiative.status).toBe('active');
    testProjectIds.push(result.initiative.id);
  });

  it('D4: validation still requires name and parent_id', async () => {
    const result = await createInitiative({
      name: '',
      parent_id: null,
      execution_mode: 'orchestrated',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('name and parent_id are required');
  });

  it('D4: orchestrated initiative with kr_id and description', async () => {
    // Create a KR goal
    const goalResult = await pool.query(`
      INSERT INTO goals (title, type, priority, status, progress)
      VALUES ('Test KR', 'kr', 'P0', 'pending', 0)
      RETURNING id
    `);
    const krId = goalResult.rows[0].id;

    const parentId = await createTestProject();
    const result = await createInitiative({
      name: 'Full Orchestrated Initiative',
      parent_id: parentId,
      kr_id: krId,
      execution_mode: 'orchestrated',
      description: 'Implement 4-phase orchestration',
      dod_content: [{ item: 'All tests pass' }],
    });

    expect(result.success).toBe(true);
    expect(result.initiative.kr_id).toBe(krId);
    expect(result.initiative.description).toBe('Implement 4-phase orchestration');
    expect(result.initiative.execution_mode).toBe('orchestrated');
    expect(result.initiative.current_phase).toBe('plan');
    testProjectIds.push(result.initiative.id);

    // Cleanup: initiative first (FK on kr_id), then goal
    await pool.query('DELETE FROM projects WHERE id = $1', [result.initiative.id]);
    await pool.query('DELETE FROM goals WHERE id = $1', [krId]);
  });
});
