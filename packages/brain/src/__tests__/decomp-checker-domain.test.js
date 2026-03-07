/**
 * decomp-checker-domain.test.js
 *
 * 测试 createInitiativePlanTask 的 domain 参数传递逻辑。
 * domain 由 checkReadyKRInitiatives 从 p.domain 读取后作为参数传入，
 * 不在函数内部做额外 SELECT 查询。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

// Mock capacity and task-quality-gate (required by decomposition-checker.js)
vi.mock('../capacity.js', () => ({
  computeCapacity: vi.fn().mockResolvedValue({ used: 0, max: 10 }),
  isAtCapacity: vi.fn().mockResolvedValue(false),
}));
vi.mock('../task-quality-gate.js', () => ({
  validateTaskDescription: vi.fn().mockReturnValue({ valid: true, reasons: [] }),
}));

import { createInitiativePlanTask } from '../decomposition-checker.js';

const INITIATIVE_ID = 'init-111';
const KR_ID = 'kr-222';
const INITIATIVE_NAME = 'Test Initiative';

function makeInsertResult(domain) {
  return {
    rows: [{ id: 'task-999', title: `Initiative 规划: ${INITIATIVE_NAME}`, domain }],
  };
}

describe('createInitiativePlanTask - domain 继承', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('Initiative domain=coding → 创建的 task.domain=coding', async () => {
    // 只有 1 次 INSERT 调用（domain 作为参数传入，不做额外 SELECT）
    mockQuery.mockResolvedValueOnce(makeInsertResult('coding'));

    const task = await createInitiativePlanTask({
      initiativeId: INITIATIVE_ID,
      krId: KR_ID,
      initiativeName: INITIATIVE_NAME,
      domain: 'coding',
    });

    expect(task.domain).toBe('coding');

    // 验证 INSERT 调用中包含 domain 参数（$6 = domain）
    const insertCall = mockQuery.mock.calls[0];
    expect(insertCall[1]).toContain('coding'); // params array contains 'coding'
  });

  it('Initiative domain=product → task.domain=product', async () => {
    mockQuery.mockResolvedValueOnce(makeInsertResult('product'));

    const task = await createInitiativePlanTask({
      initiativeId: INITIATIVE_ID,
      krId: KR_ID,
      initiativeName: INITIATIVE_NAME,
      domain: 'product',
    });

    expect(task.domain).toBe('product');
  });

  it('Initiative domain=null → task.domain=null', async () => {
    mockQuery.mockResolvedValueOnce(makeInsertResult(null));

    const task = await createInitiativePlanTask({
      initiativeId: INITIATIVE_ID,
      krId: KR_ID,
      initiativeName: INITIATIVE_NAME,
      domain: null,
    });

    expect(task.domain).toBeNull();
  });

  it('Initiative 不存在（空行）→ domain=null，任务仍创建', async () => {
    // domain=null 传入时直接创建任务，不依赖 SELECT 查询
    mockQuery.mockResolvedValueOnce(makeInsertResult(null));

    const task = await createInitiativePlanTask({
      initiativeId: INITIATIVE_ID,
      krId: KR_ID,
      initiativeName: INITIATIVE_NAME,
      domain: null,
    });

    expect(task).toBeDefined();
    expect(task.domain).toBeNull();
  });

  it('task description 包含 domain 上下文（当 domain 有值时）', async () => {
    mockQuery.mockResolvedValueOnce(makeInsertResult('quality'));

    await createInitiativePlanTask({
      initiativeId: INITIATIVE_ID,
      krId: KR_ID,
      initiativeName: INITIATIVE_NAME,
      domain: 'quality',
    });

    // description 参数（$2）应包含 domain 信息
    const insertParams = mockQuery.mock.calls[0][1];
    const description = insertParams[1];
    expect(description).toContain('quality');
    expect(description).toContain('domain');
  });

  it('INSERT SQL 包含 domain 列', async () => {
    mockQuery.mockResolvedValueOnce(makeInsertResult('coding'));

    await createInitiativePlanTask({
      initiativeId: INITIATIVE_ID,
      krId: KR_ID,
      initiativeName: INITIATIVE_NAME,
      domain: 'coding',
    });

    const insertSql = mockQuery.mock.calls[0][0];
    expect(insertSql).toContain('domain');
    expect(insertSql).toContain('RETURNING id, title, domain');
  });
});
