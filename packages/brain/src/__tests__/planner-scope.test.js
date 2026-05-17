/**
 * planner-scope.test.js
 * Tests for selectTargetScope in planner.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db before importing planner
vi.mock('../db.js', () => {
  const mockPool = {
    query: vi.fn(),
  };
  return { default: mockPool };
});

// Mock focus.js
vi.mock('../focus.js', () => ({
  getDailyFocus: vi.fn().mockResolvedValue(null),
}));

// Mock role-registry.js
vi.mock('../role-registry.js', () => ({
  getDomainRole: vi.fn().mockReturnValue(null),
  ROLES: {},
}));

// Mock domain-detector.js
vi.mock('../domain-detector.js', () => ({
  detectDomain: vi.fn().mockReturnValue('unknown'),
}));

describe('selectTargetScope', () => {
  let selectTargetScope;
  let pool;

  beforeEach(async () => {
    vi.resetAllMocks();
    const plannerModule = await import('../planner.js');
    selectTargetScope = plannerModule.selectTargetScope;
    const dbModule = await import('../db.js');
    pool = dbModule.default;
  });

  it('should be exported as a function', () => {
    expect(typeof selectTargetScope).toBe('function');
  });

  it('should return null when no scopes exist (backward-compatible)', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const project = { id: 'proj-1', name: 'Test Project' };
    const state = {};
    const result = await selectTargetScope(project, state);

    expect(result).toBeNull();
  });

  it('should return a scope when active scopes exist', async () => {
    const mockScope = {
      id: 'scope-1',
      name: 'Phase 1',
      type: 'scope',
      parent_id: 'proj-1',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
    };
    // First query: get scopes
    pool.query.mockResolvedValueOnce({ rows: [mockScope] });
    // Second query: count initiatives under scope
    pool.query.mockResolvedValueOnce({ rows: [{ count: '3' }] });

    const project = { id: 'proj-1', name: 'Test Project' };
    const state = {};
    const result = await selectTargetScope(project, state);

    expect(result).not.toBeNull();
    expect(result.id).toBe('scope-1');
  });

  it('should handle database errors gracefully', async () => {
    pool.query.mockRejectedValue(new Error('connection refused'));

    const project = { id: 'proj-1', name: 'Test Project' };
    const state = {};
    const result = await selectTargetScope(project, state);

    // Graceful degradation: returns null on error
    expect(result).toBeNull();
  });
});
