import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../../src/db.js', () => ({ default: mockPool }));

import { sanitizeJsonString, extractReportJson, claimPendingTask, reapStaleRunning } from '../skill-eval-worker.js';

describe('sanitizeJsonString — 清理字符串值内部未转义的双引号', () => {
  it('把夹在普通字符中间的英文双引号删掉，使原本非法的 JSON 变得可解析', () => {
    const broken = '{"skill":{"name":"x"},"verdict":{"level":"pass"},"summary":"他说"你好"了","anatomy":{"pipeline":[],"outputs":[]}}';
    expect(() => JSON.parse(broken)).toThrow();
    const cleaned = sanitizeJsonString(broken);
    const parsed = JSON.parse(cleaned);
    expect(parsed.skill.name).toBe('x');
    expect(parsed.summary).toBe('他说你好了');
  });

  it('结构性引号（紧跟 : , { [ } ] 的）不受影响，正常 JSON 清理后仍然是原样', () => {
    const good = JSON.stringify({ skill: { name: 'ok' }, verdict: { level: 'pass' }, anatomy: { pipeline: [], outputs: [] } });
    expect(sanitizeJsonString(good)).toBe(good);
  });
});

describe('extractReportJson — 从 `claude -p ... --output-format json` 的 stdout 解析 report_data', () => {
  it('envelope.result 是合法 JSON 字符串时直接解析成功', () => {
    const reportData = { skill: { name: 'x' }, verdict: { level: 'pass' }, anatomy: { pipeline: [], outputs: [] } };
    const stdout = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(reportData) });
    expect(extractReportJson(stdout)).toEqual(reportData);
  });

  it('envelope.result 内部 JSON 含未转义双引号时，兜底正则重试后解析成功', () => {
    const brokenResultStr = '{"skill":{"name":"x"},"verdict":{"level":"pass"},"summary":"他说"你好"了","anatomy":{"pipeline":[],"outputs":[]}}';
    const stdout = JSON.stringify({ type: 'result', result: brokenResultStr });
    const parsed = extractReportJson(stdout);
    expect(parsed.skill.name).toBe('x');
    expect(parsed.summary).toBe('他说你好了');
  });

  it('stdout 本身不是合法 JSON envelope → 抛错', () => {
    expect(() => extractReportJson('not json at all')).toThrow(/claude stdout 不是合法 JSON envelope/);
  });

  it('envelope 没有 result 字段 → 抛错', () => {
    expect(() => extractReportJson(JSON.stringify({ type: 'result' }))).toThrow(/缺少 result 字段/);
  });

  it('result 字段修完还是解析不了 → 抛错，报错信息带上两次失败原因', () => {
    const stdout = JSON.stringify({ type: 'result', result: '{not json at all' });
    expect(() => extractReportJson(stdout)).toThrow(/report_data JSON 解析失败/);
  });
});

describe('claimPendingTask — 原子取任务，消除并发竞态', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('发送的是单条 UPDATE...RETURNING 语句（不是分开的 SELECT+UPDATE）', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ task_id: 'task-1', staging_path: '/tmp/a.zip' }],
    });

    const claimed = await claimPendingTask();

    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE skill_evals/);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/RETURNING task_id::text, staging_path/);
    expect(claimed).toEqual({ task_id: 'task-1', staging_path: '/tmp/a.zip' });
  });

  it('没有 pending 任务时返回 null', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const claimed = await claimPendingTask();

    expect(claimed).toBeNull();
  });

  it('并发调用不会拿到同一条任务（用内存态模拟 FOR UPDATE SKIP LOCKED 语义）', async () => {
    // 模拟两条 pending 记录 + 一个具备"原子取一条并标记 running"语义的假 pool，
    // 用来验证调用方（claimPendingTask）确实只发一条原子语句、把互斥完全交给这条 SQL，
    // 而不是自己在应用层做两步查询再自己判断——两步式正是本次要修的 bug。
    const fakeRows = [
      { task_id: 'task-a', staging_path: '/tmp/a.zip', status: 'pending' },
      { task_id: 'task-b', staging_path: '/tmp/b.zip', status: 'pending' },
    ];
    mockPool.query.mockImplementation(async (sql) => {
      expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
      const next = fakeRows.find((r) => r.status === 'pending');
      if (!next) return { rows: [] };
      next.status = 'running';
      return { rows: [{ task_id: next.task_id, staging_path: next.staging_path }] };
    });

    const [first, second] = await Promise.all([claimPendingTask(), claimPendingTask()]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first.task_id).not.toBe(second.task_id);
    expect(new Set([first.task_id, second.task_id])).toEqual(new Set(['task-a', 'task-b']));

    // 加固断言：不仅验证互斥结果，还验证调用方确实只发了「单条原子 UPDATE...RETURNING 语句」
    // ——每次 claimPendingTask() 调用各产生一次 query（不是两步式 SELECT+UPDATE）；
    // 若有人把实现悄悄改回两步式，这里的调用次数/SQL 内容断言会先失败。
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    for (const call of mockPool.query.mock.calls) {
      const sql = call[0];
      expect(sql).toMatch(/UPDATE skill_evals/);
      expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
      expect(sql).toMatch(/RETURNING task_id::text, staging_path/);
    }
  });
});

describe('reapStaleRunning — 超时 running 任务回收', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('发出 UPDATE 把超时的 running 任务重置为 pending，并返回重置行数', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 2, rows: [] });
    const result = await reapStaleRunning(10);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE\s+skill_evals/i);
    expect(sql).toMatch(/SET\s+status\s*=\s*'pending'/i);
    expect(sql).toMatch(/WHERE\s+status\s*=\s*'running'/i);
    expect(sql).toMatch(/updated_at\s*<\s*now\(\)\s*-\s*\(?\$1\s*\*\s*interval/i);
    expect(result).toEqual({ recovered: 2 });
  });

  it('默认超时阈值为 10 分钟', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await reapStaleRunning();
    const [, params] = mockPool.query.mock.calls[0];
    expect(params).toContain(10);
  });
});
