/**
 * Decomposition Depth Limit 测试
 * DoD: D1, D2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

// Mock capacity.js
vi.mock('../capacity.js', () => ({
  computeCapacity: () => ({
    project: { max: 5, softMin: 1 },
    initiative: { max: 9, softMin: 3 },
    task: { queuedCap: 27, softMin: 9 },
  }),
  isAtCapacity: (current, max) => current >= max,
}));

// Mock task-quality-gate.js
vi.mock('../task-quality-gate.js', () => ({
  validateTaskDescription: () => ({ valid: true, reasons: [] }),
}));

describe('D2: Decomposition depth limit', () => {
  let pool;
  let checkInitiativeDecomposition;
  let MAX_DECOMPOSITION_DEPTH;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const dbModule = await import('../db.js');
    pool = dbModule.default;
    const checker = await import('../decomposition-checker.js');
    checkInitiativeDecomposition = checker.checkInitiativeDecomposition;
    MAX_DECOMPOSITION_DEPTH = checker.MAX_DECOMPOSITION_DEPTH;
  });

  it('MAX_DECOMPOSITION_DEPTH is 2', () => {
    expect(MAX_DECOMPOSITION_DEPTH).toBe(2);
  });

  it('depth >= 2 initiative includes depth warning and at_max_depth in payload', async () => {
    const initId = 'init-depth-2';
    const parentId = 'proj-parent';
    const krId = 'kr-001';

    // Check 6 query: initiative with depth=2
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: initId,
        name: '深层 Initiative',
        parent_id: parentId,
        plan_content: null,
        parent_name: 'Parent Project',
        repo_path: '/home/xx/repo',
        depth: 2
      }]
    });

    // hasExistingDecompositionTaskByProject → no dedup
    pool.query.mockResolvedValueOnce({ rows: [] });

    // Get linked KR (Layer 1: project_kr_links)
    pool.query.mockResolvedValueOnce({ rows: [{ kr_id: krId }] });

    // KR saturation check
    pool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    // createDecompositionTask INSERT
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-001', title: 'Initiative 拆解: 深层 Initiative' }]
    });

    const actions = await checkInitiativeDecomposition();

    // 验证创建了拆解任务
    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe('create_decomposition');

    // 验证 INSERT 调用的 payload 包含 at_max_depth
    const insertCall = pool.query.mock.calls.find(c =>
      c[0].includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeTruthy();
    const payloadStr = insertCall[1][4]; // 5th param is payload JSON
    const payload = JSON.parse(payloadStr);
    expect(payload.at_max_depth).toBe(true);
    expect(payload.depth).toBe(2);

    // 验证 description 包含深度限制警告
    const description = insertCall[1][1]; // 2nd param is description
    expect(description).toContain('深度限制');
    expect(description).toContain('禁止创建子 Initiative');
  });

  it('depth < 2 initiative does NOT include depth warning', async () => {
    const initId = 'init-depth-1';
    const parentId = 'proj-parent';
    const krId = 'kr-001';

    // Check 6 query: initiative with depth=1
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: initId,
        name: '普通 Initiative',
        parent_id: parentId,
        plan_content: null,
        parent_name: 'Parent Project',
        repo_path: '/home/xx/repo',
        depth: 1
      }]
    });

    // hasExistingDecompositionTaskByProject → no dedup
    pool.query.mockResolvedValueOnce({ rows: [] });

    // Get linked KR
    pool.query.mockResolvedValueOnce({ rows: [{ kr_id: krId }] });

    // KR saturation check
    pool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    // createDecompositionTask INSERT
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-002', title: 'Initiative 拆解: 普通 Initiative' }]
    });

    const actions = await checkInitiativeDecomposition();

    expect(actions.length).toBe(1);

    // 验证 payload 不包含 at_max_depth
    const insertCall = pool.query.mock.calls.find(c =>
      c[0].includes('INSERT INTO tasks')
    );
    const payloadStr = insertCall[1][4];
    const payload = JSON.parse(payloadStr);
    expect(payload.at_max_depth).toBe(false);
    expect(payload.depth).toBe(1);

    // 验证 description 不包含深度限制警告
    const description = insertCall[1][1];
    expect(description).not.toContain('深度限制');
  });

  it('depth >= 2 allows dev task creation (decomposition task still created)', async () => {
    // 这个测试验证：depth >= 2 时仍然创建拆解任务，但任务描述强调只能产出 dev tasks
    const initId = 'init-depth-3';

    pool.query.mockResolvedValueOnce({
      rows: [{
        id: initId,
        name: '最深层 Initiative',
        parent_id: 'proj-001',
        plan_content: null,
        parent_name: 'Project',
        repo_path: '/repo',
        depth: 3  // 超过 max
      }]
    });

    pool.query.mockResolvedValueOnce({ rows: [] }); // dedup
    pool.query.mockResolvedValueOnce({ rows: [{ kr_id: 'kr-001' }] }); // KR link
    pool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] }); // saturation
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'task-003', title: 'Initiative 拆解: 最深层 Initiative' }]
    });

    const actions = await checkInitiativeDecomposition();

    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe('create_decomposition');

    const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO tasks'));
    const description = insertCall[1][1];
    expect(description).toContain('禁止创建子 Initiative');
    expect(description).toContain('只能创建具体的 dev Task');
  });
});
