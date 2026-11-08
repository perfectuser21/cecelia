/** 真实execution HTTP事务/参数合同；数据库及后置依赖均record-only。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient, mockPool, mockReqRes, transactionPhases, callbackPoolResponse } from './helpers/callback-atomic-fixture.js';

describe('execution-callback atomicity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockImplementation(async sql => ({ rows: [],
      rowCount: sql.includes('UPDATE tasks') || sql.includes('INSERT INTO decision_log') ? 1 : null }));
    mockPool.query.mockImplementation(callbackPoolResponse);
  });

  it('should use BEGIN/COMMIT transaction for callback processing', async () => {
    // Mock the pool.query for progress rollup (after transaction)
    // 幂等性检查 (decision_log) 必须返回空 rows，否则会提前 return duplicate
    mockPool.query.mockImplementation(callbackPoolResponse);

    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-tx-1',
      run_id: 'run-tx-1',
      status: 'AI Done',
      result: { result: 'success' },
      duration_ms: 5000,
      iterations: 1,
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.duplicate).not.toBe(true);
    expect(transactionPhases()).toEqual(['BEGIN', 'UPDATE', 'INSERT', 'COMMIT']);
    const params = mockClient.query.mock.calls[2][1];
    expect(params[0]).toBe('execution-callback');
    expect(JSON.parse(params[2])).toEqual({ task_id: 'task-tx-1', run_id: 'run-tx-1', status: 'AI Done', iterations: 1 });
    expect(params.slice(4)).toEqual(['success', 'run-tx-1', 'AI Done']);

    // 真实事务四阶段已在上方精确断言；下列保留原BEGIN/COMMIT兼容检查。
    const clientCalls = mockClient.query.mock.calls;
    expect(clientCalls[0][0]).toBe('BEGIN');
    const commitCalls = clientCalls.filter(c => typeof c[0] === 'string' && c[0] === 'COMMIT');
    expect(commitCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('UPDATE零行提交后返回CAS duplicate，绝不INSERT日志', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-cas-duplicate', run_id: 'run-cas-duplicate', status: 'AI Done',
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ success: true, duplicate: true, reason: 'callback_compare_and_set_rejected' });
    expect(transactionPhases()).toEqual(['BEGIN', 'UPDATE', 'COMMIT']);
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it('已记同run/status的日志在事务前duplicate，不UPDATE或INSERT', async () => {
    mockPool.query.mockImplementation(async sql => ({ rows: sql.includes('FROM decision_log') ? [{ id: 'owned-log' }] : [], rowCount: 1 }));
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-log-duplicate', run_id: 'run-log-duplicate', status: 'AI Done',
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ success: true, duplicate: true });
    expect(mockPool.connect).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('UPDATE成功后INSERT日志失败必须ROLLBACK而不能COMMIT', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockRejectedValueOnce(Error('owned decision log failure'));
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-insert-failure', run_id: 'run-insert-failure', status: 'AI Done',
    });
    expect(response.statusCode).toBe(500);
    expect(transactionPhases()).toEqual(['BEGIN', 'UPDATE', 'INSERT', 'ROLLBACK']);
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it('should ROLLBACK on transaction error', async () => {
    // Make the UPDATE inside transaction fail
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(new Error('DB write error')); // UPDATE fails

    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-tx-fail',
      run_id: 'run-tx-fail',
      status: 'AI Done',
    });

    expect(result.statusCode).toBe(500);

    // Verify ROLLBACK was called
    const rollbackCalls = mockClient.query.mock.calls.filter(c => c[0] === 'ROLLBACK');
    expect(rollbackCalls.length).toBe(1);
  });

  it('should always release client even on error', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(new Error('fail'));

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-release',
      status: 'AI Done',
    });

    expect(mockClient.release).toHaveBeenCalled();
  });

  it('UPDATE tasks should use boolean $6 for completed_at, not reuse $2 in CASE WHEN', async () => {
    // Regression test: "inconsistent types deduced for parameter $2 (text vs character varying)"
    // The fix extracts isCompleted as a separate boolean param ($6) to avoid $2 type ambiguity.
    mockPool.query.mockImplementation(callbackPoolResponse);

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-sql-type',
      run_id: 'run-sql-type',
      status: 'AI Done',
      result: { result: 'ok' },
      duration_ms: 1000,
      iterations: 1,
    });

    // Find the UPDATE tasks call (after BEGIN)
    const clientCalls = mockClient.query.mock.calls;
    const updateCall = clientCalls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks'));
    expect(updateCall).toBeDefined();

    // 14 params：原写入字段 + exec meta + terminal 清 run claim + run_id CAS。
    const params = updateCall[1];
    expect(params).toHaveLength(14);

    // $6 (isCompleted) must be a boolean true for 'AI Done'
    expect(typeof params[5]).toBe('boolean');
    expect(params[5]).toBe(true);

    // $2 (newStatus) must be 'completed'
    expect(params[1]).toBe('completed');

    // $9 (errorMessage) must be null for successful tasks
    expect(params[8]).toBeNull();
    // $10 (blockedDetail) must be null for successful tasks
    expect(params[9]).toBeNull();
  });

  it('isCompleted should be false for AI Failed status', async () => {
    mockPool.query.mockImplementation(callbackPoolResponse);

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-failed-type',
      run_id: 'run-failed-type',
      status: 'AI Failed',
      duration_ms: 500,
      iterations: 1,
    });

    const clientCalls = mockClient.query.mock.calls;
    const updateCall = clientCalls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks'));
    expect(updateCall).toBeDefined();

    const params = updateCall[1];
    expect(params).toHaveLength(14);
    // $6 must be false for failed tasks
    expect(params[5]).toBe(false);
    expect(params[1]).toBe('failed');
  });
});

describe('execution-callback findings storage (D1/D2/D3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockImplementation(async sql => ({ rows: [],
      rowCount: sql.includes('UPDATE tasks') || sql.includes('INSERT INTO decision_log') ? 1 : null }));
    mockPool.query.mockImplementation(callbackPoolResponse);
  });

  function getUpdateParams() {
    const calls = mockClient.query.mock.calls;
    const call = calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks'));
    return call ? call[1] : null;
  }

  it('D1: stores result.findings as $7 when result has findings field', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-findings-1',
      run_id: 'run-findings-1',
      status: 'AI Done',
      result: { findings: 'These are the research findings about X' },
    });

    const params = getUpdateParams();
    expect(params).not.toBeNull();
    // $7 (findingsValue) should be the findings string
    expect(params[6]).toBe('These are the research findings about X');
  });

  it('D1: stores result.result as $7 when result has result field but no findings', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-findings-2',
      run_id: 'run-findings-2',
      status: 'AI Done',
      result: { result: 'Research conclusion text' },
    });

    const params = getUpdateParams();
    expect(params).not.toBeNull();
    expect(params[6]).toBe('Research conclusion text');
  });

  it('D1: stores string result directly as $7', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-findings-3',
      run_id: 'run-findings-3',
      status: 'AI Done',
      result: 'Direct string result from task',
    });

    const params = getUpdateParams();
    expect(params).not.toBeNull();
    expect(params[6]).toBe('Direct string result from task');
  });

  it('D1: $7 is null when result is null/empty', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-findings-null',
      run_id: 'run-findings-null',
      status: 'AI Done',
      result: null,
    });

    const params = getUpdateParams();
    expect(params).not.toBeNull();
    // $7 should be null when no findings
    expect(params[6]).toBeNull();
  });

  it('D2: logs WARN when completed task has empty findings', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-no-findings',
      run_id: 'run-no-findings',
      status: 'AI Done',
      result: null,
    });

    const warnCalls = warnSpy.mock.calls.flat().join(' ');
    expect(warnCalls).toContain('empty findings');
    expect(warnCalls).toContain('task-no-findings');
    warnSpy.mockRestore();
  });

  it('D2: does NOT warn when failed task has empty findings (only completed tasks)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-failed-no-findings',
      run_id: 'run-failed',
      status: 'AI Failed',
      result: null,
    });

    const warnCalls = warnSpy.mock.calls.flat().join(' ');
    // Failed tasks should not warn about empty findings
    expect(warnCalls).not.toContain('empty findings');
    warnSpy.mockRestore();
  });

  it('D3: SQL includes CASE WHEN for findings field in payload', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-sql-findings',
      run_id: 'run-sql-findings',
      status: 'AI Done',
      result: { findings: 'test finding' },
    });

    const calls = mockClient.query.mock.calls;
    const updateCall = calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks'));
    expect(updateCall).toBeDefined();

    // SQL must include findings merge logic
    expect(updateCall[0]).toContain('findings');
    expect(updateCall[0]).toContain('CASE WHEN');
    expect(updateCall[0]).toContain('jsonb_build_object');
  });
});

describe('execution-callback pr_number 提取 (DoD-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockImplementation(async sql => ({ rows: [],
      rowCount: sql.includes('UPDATE tasks') || sql.includes('INSERT INTO decision_log') ? 1 : null }));
    mockPool.query.mockImplementation(callbackPoolResponse);
  });

  it('从 pr_url 提取 pr_number 并作为 $8 参数传给 SQL', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-pr-number',
      run_id: 'run-pr-number',
      status: 'AI Done',
      pr_url: 'https://github.com/perfectuser21/cecelia/pull/123',
    });

    const calls = mockClient.query.mock.calls;
    const updateCall = calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks'));
    expect(updateCall).toBeDefined();

    const params = updateCall[1];
    // $8 (prNumber) must be 123
    expect(params[7]).toBe(123);
    // SQL must include metadata merge with pr_number
    expect(updateCall[0]).toContain('metadata');
    expect(updateCall[0]).toContain('pr_number');
  });

  it('无 pr_url 时 $8 (prNumber) 为 null', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-no-pr',
      run_id: 'run-no-pr',
      status: 'AI Done',
    });

    const calls = mockClient.query.mock.calls;
    const updateCall = calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks'));
    expect(updateCall).toBeDefined();

    const params = updateCall[1];
    expect(params[7]).toBeNull();
  });

  it('pr_url 格式异常时 $8 (prNumber) 为 null', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-bad-url',
      run_id: 'run-bad-url',
      status: 'AI Done',
      pr_url: 'https://github.com/owner/repo/issues/456', // issue 不是 pull
    });

    const calls = mockClient.query.mock.calls;
    const updateCall = calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks'));
    expect(updateCall).toBeDefined();

    const params = updateCall[1];
    expect(params[7]).toBeNull();
  });
});
