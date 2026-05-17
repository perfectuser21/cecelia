/**
 * auto-fix-circuit-breaker.test.js
 * 测试 dispatchToDevSkill 熔断机制（P0 修复）
 * 覆盖：活跃任务去重（queued/in_progress）+ 失败次数上限（MAX_AUTO_FIX_ATTEMPTS）
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Mock pg pool — hoisted
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// Mock actions.js createTask — hoisted
const mockCreateTask = vi.hoisted(() => vi.fn());
vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));

let dispatchToDevSkill, MAX_AUTO_FIX_ATTEMPTS;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../auto-fix.js');
  dispatchToDevSkill = mod.dispatchToDevSkill;
  MAX_AUTO_FIX_ATTEMPTS = mod.MAX_AUTO_FIX_ATTEMPTS;
});

const baseFailure = {
  task_id: 'task-1',
  reason_code: 'PROBE_FAIL_DB',
  layer: 'probe',
  step_name: 'db',
  run_id: null,
};

const baseRca = {
  confidence: 0.85,
  root_cause: 'DB 连接池耗尽',
  proposed_fix: '增加连接池大小，并加入重试逻辑',
  action_plan: '1. 修改 db.js max 参数 2. 加重试 3. 测试',
  evidence: 'pool exhausted log',
};

describe('dispatchToDevSkill — Guard 1: queued/in_progress 活跃任务去重', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('已有 queued 任务 → 返回 null，不创建新任务', async () => {
    // Guard 1 查询返回 active_count=1（queued 任务）
    mockQuery.mockResolvedValueOnce({ rows: [{ active_count: '1' }] });

    const result = await dispatchToDevSkill(baseFailure, baseRca, 'probe_db');
    expect(result).toBeNull();
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('已有 in_progress 任务 → 返回 null，不创建新任务', async () => {
    // Guard 1 查询返回 active_count=2（in_progress 任务）
    mockQuery.mockResolvedValueOnce({ rows: [{ active_count: '2' }] });

    const result = await dispatchToDevSkill(baseFailure, baseRca, 'probe_notify');
    expect(result).toBeNull();
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('无活跃任务（active_count=0）→ 继续执行后续逻辑', async () => {
    // Guard 1 查询返回 active_count=0
    mockQuery.mockResolvedValueOnce({ rows: [{ active_count: '0' }] });
    // Guard 2 查询返回 failed_count=0
    mockQuery.mockResolvedValueOnce({ rows: [{ failed_count: '0' }] });
    // createTask 返回任务 ID
    mockCreateTask.mockResolvedValueOnce('new-task-id-123');

    const result = await dispatchToDevSkill(baseFailure, baseRca, 'probe_db');
    expect(result).toBe('new-task-id-123');
    expect(mockCreateTask).toHaveBeenCalledOnce();
  });

  it('Guard 1 查询使用正确的 SQL 条件（IN queued, in_progress）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ active_count: '1' }] });

    await dispatchToDevSkill(baseFailure, baseRca, 'probe_dispatch');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('queued');
    expect(sql).toContain('in_progress');
    expect(sql).toContain('auto_fix');
  });
});

describe('dispatchToDevSkill — Guard 2: MAX_AUTO_FIX_ATTEMPTS 失败上限', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('MAX_AUTO_FIX_ATTEMPTS 已导出且为正整数', () => {
    expect(typeof MAX_AUTO_FIX_ATTEMPTS).toBe('number');
    expect(MAX_AUTO_FIX_ATTEMPTS).toBeGreaterThan(0);
  });

  it('失败次数 >= MAX_AUTO_FIX_ATTEMPTS → 返回 null，熔断', async () => {
    // Guard 1: 无活跃任务
    mockQuery.mockResolvedValueOnce({ rows: [{ active_count: '0' }] });
    // Guard 2: 失败次数已达上限
    mockQuery.mockResolvedValueOnce({ rows: [{ failed_count: String(MAX_AUTO_FIX_ATTEMPTS) }] });

    const result = await dispatchToDevSkill(baseFailure, baseRca, 'probe_db');
    expect(result).toBeNull();
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('失败次数 < MAX_AUTO_FIX_ATTEMPTS → 正常创建任务', async () => {
    // Guard 1: 无活跃任务
    mockQuery.mockResolvedValueOnce({ rows: [{ active_count: '0' }] });
    // Guard 2: 失败次数未达上限
    mockQuery.mockResolvedValueOnce({ rows: [{ failed_count: String(MAX_AUTO_FIX_ATTEMPTS - 1) }] });
    mockCreateTask.mockResolvedValueOnce('task-xyz');

    const result = await dispatchToDevSkill(baseFailure, baseRca, 'probe_db');
    expect(result).toBe('task-xyz');
    expect(mockCreateTask).toHaveBeenCalledOnce();
  });
});
