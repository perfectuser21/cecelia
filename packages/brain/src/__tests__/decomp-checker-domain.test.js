/**
 * decomp-checker-domain.test.js
 *
 * 测试 createInitiativePlanTask 的 domain 继承逻辑。
 * Initiative.domain → initiative_plan task.domain
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
    // 第 1 次调用：SELECT domain FROM projects → coding
    mockQuery.mockResolvedValueOnce({ rows: [{ domain: 'coding' }] });
    // 第 2 次调用：INSERT tasks → 返回带 domain 的任务
    mockQuery.mockResolvedValueOnce(makeInsertResult('coding'));

    const task = await createInitiativePlanTask({
      initiativeId: INITIATIVE_ID,
      krId: KR_ID,
      initiativeName: INITIATIVE_NAME,
    });

    expect(task.domain).toBe('coding');

    // 验证 INSERT 调用中包含 domain 参数（$5 = 'coding'）
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[1]).toContain('coding'); // params array contains 'coding'
  });

  it('Initiative domain=product → task.domain=product', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ domain: 'product' }] });
    mockQuery.mockResolvedValueOnce(makeInsertResult('product'));

    const task = await createInitiativePlanTask({
      initiativeId: INITIATIVE_ID,
      krId: KR_ID,
      initiativeName: INITIATIVE_NAME,
    });

    expect(task.domain).toBe('product');
  });

  it('Initiative domain=null → task.domain=null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ domain: null }] });
    mockQuery.mockResolvedValueOnce(makeInsertResult(null));

    const task = await createInitiativePlanTask({
      initiativeId: INITIATIVE_ID,
      krId: KR_ID,
      initiativeName: INITIATIVE_NAME,
    });

    expect(task.domain).toBeNull();
  });

  it('Initiative 不存在（空行）→ domain=null，任务仍创建', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no initiative found
    mockQuery.mockResolvedValueOnce(makeInsertResult(null));

    const task = await createInitiativePlanTask({
      initiativeId: INITIATIVE_ID,
      krId: KR_ID,
      initiativeName: INITIATIVE_NAME,
    });

    expect(task).toBeDefined();
    expect(task.domain).toBeNull();
  });

  it('domain 查询报错时 → 降级为 null，任务仍创建', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));
    mockQuery.mockResolvedValueOnce(makeInsertResult(null));

    const task = await createInitiativePlanTask({
      initiativeId: INITIATIVE_ID,
      krId: KR_ID,
      initiativeName: INITIATIVE_NAME,
    });

    expect(task).toBeDefined();
    // domain 查询失败时 fallback 为 null
    const insertParams = mockQuery.mock.calls[1][1];
    expect(insertParams[4]).toBeNull(); // $5 parameter = domain
  });

  it('task description 包含 domain 上下文（当 domain 有值时）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ domain: 'quality' }] });
    mockQuery.mockResolvedValueOnce(makeInsertResult('quality'));

    await createInitiativePlanTask({
      initiativeId: INITIATIVE_ID,
      krId: KR_ID,
      initiativeName: INITIATIVE_NAME,
    });

    // description 参数（$2）应包含 domain 信息
    const insertParams = mockQuery.mock.calls[1][1];
    const description = insertParams[1];
    expect(description).toContain('quality');
    expect(description).toContain('domain');
  });

  it('INSERT SQL 包含 domain 列', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ domain: 'coding' }] });
    mockQuery.mockResolvedValueOnce(makeInsertResult('coding'));

    await createInitiativePlanTask({
      initiativeId: INITIATIVE_ID,
      krId: KR_ID,
      initiativeName: INITIATIVE_NAME,
    });

    const insertSql = mockQuery.mock.calls[1][0];
    expect(insertSql).toContain('domain');
    expect(insertSql).toContain('RETURNING id, title, domain');
  });
});
