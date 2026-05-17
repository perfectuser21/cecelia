/**
 * Actions - createInitiative orchestration 支持测试
 *
 * DoD 覆盖: D4
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';

// isolate:false 修复：延迟导入，确保获取真实 pool 而非其他文件残留的 mock
let pool, createInitiative;

beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../db.js')).default;
  createInitiative = (await import('../actions.js')).createInitiative;
});

let testScopeIds = [];
let testOkrProjectIds = [];

// createInitiative 现在需要 scope_id（来自 okr_scopes），不再是 projects.id
// 创建 okr_projects → okr_scopes 链，返回 scope_id 作为 parent_id
async function createTestScope() {
  const projResult = await pool.query(`
    INSERT INTO okr_projects (title, status)
    VALUES ('Test OKR Project for Initiative', 'active')
    RETURNING id
  `);
  const okrProjectId = projResult.rows[0].id;
  testOkrProjectIds.push(okrProjectId);

  const scopeResult = await pool.query(`
    INSERT INTO okr_scopes (title, project_id, status)
    VALUES ('Test Scope for Initiative', $1, 'active')
    RETURNING id
  `, [okrProjectId]);
  const scopeId = scopeResult.rows[0].id;
  testScopeIds.push(scopeId);
  return scopeId;
}

describe('createInitiative - orchestration support', () => {
  afterEach(async () => {
    // Clean up: initiatives first (ON DELETE CASCADE via scope_id), then scopes, then okr_projects
    if (testScopeIds.length > 0) {
      await pool.query('DELETE FROM okr_initiatives WHERE scope_id = ANY($1)', [testScopeIds]).catch(() => {});
      await pool.query('DELETE FROM okr_scopes WHERE id = ANY($1)', [testScopeIds]).catch(() => {});
      testScopeIds = [];
    }
    if (testOkrProjectIds.length > 0) {
      await pool.query('DELETE FROM okr_projects WHERE id = ANY($1)', [testOkrProjectIds]).catch(() => {});
      testOkrProjectIds = [];
    }
  });

  it('D4: default execution_mode is cecelia', async () => {
    const parentId = await createTestScope();
    const result = await createInitiative({
      name: 'Simple Initiative',
      parent_id: parentId,
    });

    expect(result.success).toBe(true);
    expect(result.initiative.execution_mode).toBe('cecelia');
    expect(result.initiative.current_phase).toBeNull();
    expect(result.initiative.dod_content).toBeNull();
  });

  it('D4: orchestrated initiative sets current_phase=plan', async () => {
    const parentId = await createTestScope();
    const result = await createInitiative({
      name: 'Orchestrated Initiative',
      parent_id: parentId,
      execution_mode: 'orchestrated',
    });

    expect(result.success).toBe(true);
    expect(result.initiative.execution_mode).toBe('orchestrated');
    expect(result.initiative.current_phase).toBe('plan');
    expect(result.initiative.status).toBe('active');
  });

  it('D4: orchestrated initiative with dod_content', async () => {
    const parentId = await createTestScope();
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
  });

  it('D4: simple initiative ignores dod_content gracefully', async () => {
    const parentId = await createTestScope();
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
  });

  it('D4: backward compat - no execution_mode defaults to cecelia', async () => {
    const parentId = await createTestScope();
    const result = await createInitiative({
      name: 'Legacy Initiative',
      parent_id: parentId,
      description: 'Created without execution_mode',
    });

    expect(result.success).toBe(true);
    expect(result.initiative.execution_mode).toBe('cecelia');
    expect(result.initiative.current_phase).toBeNull();
    expect(result.initiative.status).toBe('active');
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
    // kr_id 存入 metadata JSONB，不需要 FK 约束，用任意 UUID 即可
    const krId = '00000000-0000-0000-0000-000000000001';

    const parentId = await createTestScope();
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
  });
});
