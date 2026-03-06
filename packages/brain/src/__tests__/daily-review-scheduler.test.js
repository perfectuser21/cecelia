/**
 * daily-review-scheduler.test.js
 * 每日代码审查调度器完整单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isInDailyWindow,
  isInContractScanWindow,
  hasTodayReview,
  hasTodayContractScan,
  createCodeReviewTask,
  getActiveRepoPaths,
  triggerDailyReview,
  triggerContractScan,
} from '../daily-review-scheduler.js';

// ============================================================
// isInDailyWindow（每日代码审查触发窗口 02:00-02:05 UTC）
// ============================================================
describe('isInDailyWindow', () => {
  it('02:00 UTC 触发', () => {
    const d = new Date('2026-02-24T02:00:00Z');
    expect(isInDailyWindow(d)).toBe(true);
  });

  it('02:04 UTC 仍在窗口内', () => {
    const d = new Date('2026-02-24T02:04:00Z');
    expect(isInDailyWindow(d)).toBe(true);
  });

  it('02:04:59 UTC 仍在窗口内', () => {
    const d = new Date('2026-02-24T02:04:59Z');
    expect(isInDailyWindow(d)).toBe(true);
  });

  it('02:05 UTC 超出窗口', () => {
    const d = new Date('2026-02-24T02:05:00Z');
    expect(isInDailyWindow(d)).toBe(false);
  });

  it('其他时间不触发（10:30）', () => {
    const d = new Date('2026-02-24T10:30:00Z');
    expect(isInDailyWindow(d)).toBe(false);
  });

  it('01:59 UTC 不触发', () => {
    const d = new Date('2026-02-24T01:59:00Z');
    expect(isInDailyWindow(d)).toBe(false);
  });

  it('00:00 UTC 不触发', () => {
    const d = new Date('2026-02-24T00:00:00Z');
    expect(isInDailyWindow(d)).toBe(false);
  });

  it('03:00 UTC 不触发（契约扫描窗口，不是代码审查窗口）', () => {
    const d = new Date('2026-02-24T03:00:00Z');
    expect(isInDailyWindow(d)).toBe(false);
  });

  it('23:59 UTC 不触发', () => {
    const d = new Date('2026-02-24T23:59:00Z');
    expect(isInDailyWindow(d)).toBe(false);
  });

  it('不传参时使用当前时间（不抛错）', () => {
    // 只验证不抛异常，返回布尔值
    const result = isInDailyWindow();
    expect(typeof result).toBe('boolean');
  });
});

// ============================================================
// isInContractScanWindow（契约扫描触发窗口 03:00-03:05 UTC）
// ============================================================
describe('isInContractScanWindow', () => {
  it('03:00 UTC 触发', () => {
    const d = new Date('2026-03-05T03:00:00Z');
    expect(isInContractScanWindow(d)).toBe(true);
  });

  it('03:04 UTC 仍在窗口内', () => {
    const d = new Date('2026-03-05T03:04:00Z');
    expect(isInContractScanWindow(d)).toBe(true);
  });

  it('03:05 UTC 超出窗口', () => {
    const d = new Date('2026-03-05T03:05:00Z');
    expect(isInContractScanWindow(d)).toBe(false);
  });

  it('02:00 UTC 不触发（代码审查窗口，不是契约扫描窗口）', () => {
    const d = new Date('2026-03-05T02:00:00Z');
    expect(isInContractScanWindow(d)).toBe(false);
  });

  it('10:30 UTC 不触发', () => {
    const d = new Date('2026-03-05T10:30:00Z');
    expect(isInContractScanWindow(d)).toBe(false);
  });

  it('不传参时使用当前时间（不抛错）', () => {
    const result = isInContractScanWindow();
    expect(typeof result).toBe('boolean');
  });
});

// ============================================================
// hasTodayReview
// ============================================================
describe('hasTodayReview', () => {
  it('今天已有 review，返回 true', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'abc' }] }) };
    const result = await hasTodayReview(pool, '/home/xx/perfect21/cecelia');
    expect(result).toBe(true);
  });

  it('今天无 review，返回 false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await hasTodayReview(pool, '/home/xx/perfect21/cecelia');
    expect(result).toBe(false);
  });

  it('SQL 查询包含 code_review task_type 和 repo_path 参数', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await hasTodayReview(pool, '/some/path');
    const sql = pool.query.mock.calls[0][0];
    const params = pool.query.mock.calls[0][1];
    expect(sql).toContain("task_type = 'code_review'");
    expect(sql).toContain("payload->>'repo_path'");
    expect(params).toEqual(['/some/path']);
  });

  it('数据库查询失败时抛出错误', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('DB connection refused')) };
    await expect(hasTodayReview(pool, '/some/path')).rejects.toThrow('DB connection refused');
  });
});

// ============================================================
// hasTodayContractScan
// ============================================================
describe('hasTodayContractScan', () => {
  it('今天已有 contract-scan 任务，返回 true', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'cs-1' }] }) };
    const result = await hasTodayContractScan(pool);
    expect(result).toBe(true);
  });

  it('今天无 contract-scan 任务，返回 false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await hasTodayContractScan(pool);
    expect(result).toBe(false);
  });

  it('SQL 查询包含 task_type=dev 和 created_by=contract-scan', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await hasTodayContractScan(pool);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("task_type = 'dev'");
    expect(sql).toContain("created_by = 'contract-scan'");
  });

  it('数据库查询失败时抛出错误', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('DB timeout')) };
    await expect(hasTodayContractScan(pool)).rejects.toThrow('DB timeout');
  });
});

// ============================================================
// getActiveRepoPaths
// ============================================================
describe('getActiveRepoPaths', () => {
  it('从 DB 返回 repo 列表', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { repo_path: '/home/xx/perfect21/cecelia' },
          { repo_path: '/home/xx/perfect21/zenithjoy/workspace' },
        ],
      }),
    };
    const paths = await getActiveRepoPaths(pool);
    expect(paths).toEqual([
      '/home/xx/perfect21/cecelia',
      '/home/xx/perfect21/zenithjoy/workspace',
    ]);
  });

  it('DB 返回空时给出空数组', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const paths = await getActiveRepoPaths(pool);
    expect(paths).toEqual([]);
  });

  it('SQL 查询过滤 NULL 和空字符串的 repo_path', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await getActiveRepoPaths(pool);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('repo_path IS NOT NULL');
    expect(sql).toContain("repo_path != ''");
  });

  it('数据库查询失败时抛出错误', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('query failed')) };
    await expect(getActiveRepoPaths(pool)).rejects.toThrow('query failed');
  });
});

// ============================================================
// createCodeReviewTask
// ============================================================
describe('createCodeReviewTask', () => {
  it('不重复：已有 review 则跳过', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'existing' }] }) };
    const result = await createCodeReviewTask(pool, '/home/xx/perfect21/cecelia');
    expect(result.created).toBe(false);
    expect(result.reason).toBe('already_today');
    expect(result.repo_path).toBe('/home/xx/perfect21/cecelia');
  });

  it('创建新任务成功', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })          // hasTodayReview -> false
        .mockResolvedValueOnce({ rows: [{ id: 'new-task-id' }] }), // INSERT
    };
    const result = await createCodeReviewTask(pool, '/home/xx/perfect21/cecelia');
    expect(result.created).toBe(true);
    expect(result.task_id).toBe('new-task-id');
    expect(result.repo_path).toBe('/home/xx/perfect21/cecelia');
  });

  it('INSERT payload 包含正确的 repo_path、since_hours、scope', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'task-123' }] }),
    };
    await createCodeReviewTask(pool, '/home/xx/perfect21/cecelia');

    const insertCall = pool.query.mock.calls[1];
    const payloadJson = insertCall[1][1]; // 第二个参数的第二个值
    const payload = JSON.parse(payloadJson);
    expect(payload.repo_path).toBe('/home/xx/perfect21/cecelia');
    expect(payload.since_hours).toBe(24);
    expect(payload.scope).toBe('daily');
  });

  it('任务标题包含 repo 名称和日期', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'task-456' }] }),
    };
    await createCodeReviewTask(pool, '/home/xx/perfect21/cecelia');

    const insertCall = pool.query.mock.calls[1];
    const title = insertCall[1][0]; // 第二个参数的第一个值
    expect(title).toContain('[code-review]');
    expect(title).toContain('cecelia');
    // 标题应包含日期格式 YYYY-MM-DD
    expect(title).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('INSERT SQL 包含正确的 task_type 和 priority', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'task-789' }] }),
    };
    await createCodeReviewTask(pool, '/some/repo');

    const insertSQL = pool.query.mock.calls[1][0];
    expect(insertSQL).toContain("'code_review'");
    expect(insertSQL).toContain("'queued'");
    expect(insertSQL).toContain("'P2'");
    expect(insertSQL).toContain("'cecelia-brain'");
    expect(insertSQL).toContain("'brain_auto'");
    expect(insertSQL).toContain("'us'");
  });

  it('hasTodayReview 查询失败时传播错误', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('DB error in check')) };
    await expect(createCodeReviewTask(pool, '/some/repo')).rejects.toThrow('DB error in check');
  });

  it('INSERT 查询失败时传播错误', async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })          // hasTodayReview -> false
        .mockRejectedValueOnce(new Error('INSERT failed')), // INSERT 失败
    };
    await expect(createCodeReviewTask(pool, '/some/repo')).rejects.toThrow('INSERT failed');
  });
});

// ============================================================
// triggerDailyReview
// ============================================================
describe('triggerDailyReview', () => {
  it('非触发时间直接跳过，不查询数据库', async () => {
    const pool = { query: vi.fn() };
    const notTriggerTime = new Date('2026-02-24T10:00:00Z');
    const result = await triggerDailyReview(pool, notTriggerTime);
    expect(result.skipped_window).toBe(true);
    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.results).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('触发时间内，为每个 repo 创建任务', async () => {
    const triggerTime = new Date('2026-02-24T02:01:00Z');
    const pool = {
      query: vi.fn()
        // getActiveRepoPaths
        .mockResolvedValueOnce({
          rows: [
            { repo_path: '/home/xx/perfect21/cecelia' },
            { repo_path: '/home/xx/perfect21/zenithjoy/workspace' },
          ],
        })
        // hasTodayReview for repo 1 -> false
        .mockResolvedValueOnce({ rows: [] })
        // INSERT repo 1
        .mockResolvedValueOnce({ rows: [{ id: 'task-1' }] })
        // hasTodayReview for repo 2 -> false
        .mockResolvedValueOnce({ rows: [] })
        // INSERT repo 2
        .mockResolvedValueOnce({ rows: [{ id: 'task-2' }] }),
    };

    const result = await triggerDailyReview(pool, triggerTime);
    expect(result.skipped_window).toBe(false);
    expect(result.triggered).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].created).toBe(true);
    expect(result.results[1].created).toBe(true);
  });

  it('触发时间但 repo 已有 review，跳过', async () => {
    const triggerTime = new Date('2026-02-24T02:02:00Z');
    const pool = {
      query: vi.fn()
        // getActiveRepoPaths
        .mockResolvedValueOnce({ rows: [{ repo_path: '/home/xx/perfect21/cecelia' }] })
        // hasTodayReview -> true
        .mockResolvedValueOnce({ rows: [{ id: 'existing' }] }),
    };
    const result = await triggerDailyReview(pool, triggerTime);
    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.results[0].created).toBe(false);
    expect(result.results[0].reason).toBe('already_today');
  });

  it('DB 返回空 repo 列表时使用 fallback', async () => {
    const triggerTime = new Date('2026-02-24T02:00:00Z');
    let queryCallCount = 0;
    const pool = {
      query: vi.fn().mockImplementation(() => {
        queryCallCount++;
        if (queryCallCount === 1) {
          // getActiveRepoPaths -> empty
          return Promise.resolve({ rows: [] });
        }
        // 后续调用：偶数次 = hasTodayReview (false)，奇数次 = INSERT
        if (queryCallCount % 2 === 0) {
          return Promise.resolve({ rows: [] }); // hasTodayReview -> false
        }
        return Promise.resolve({ rows: [{ id: `fallback-task-${queryCallCount}` }] }); // INSERT
      }),
    };

    const result = await triggerDailyReview(pool, triggerTime);
    expect(result.skipped_window).toBe(false);
    // 使用 fallback 列表，应有多个任务被创建
    expect(pool.query.mock.calls.length).toBeGreaterThan(1);
    expect(typeof result.triggered).toBe('number');
  });

  it('混合场景：部分 repo 已有 review，部分新建', async () => {
    const triggerTime = new Date('2026-02-24T02:03:00Z');
    const pool = {
      query: vi.fn()
        // getActiveRepoPaths
        .mockResolvedValueOnce({
          rows: [
            { repo_path: '/repo/a' },
            { repo_path: '/repo/b' },
            { repo_path: '/repo/c' },
          ],
        })
        // repo a: hasTodayReview -> true (已存在)
        .mockResolvedValueOnce({ rows: [{ id: 'existing-a' }] })
        // repo b: hasTodayReview -> false, INSERT
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'new-b' }] })
        // repo c: hasTodayReview -> false, INSERT
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'new-c' }] }),
    };

    const result = await triggerDailyReview(pool, triggerTime);
    expect(result.triggered).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.results).toHaveLength(3);
  });

  it('getActiveRepoPaths 抛错时被 catch 捕获，不影响返回', async () => {
    const triggerTime = new Date('2026-02-24T02:00:00Z');
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('DB connection lost')),
    };

    // triggerDailyReview 内部有 try/catch，不应抛出
    const result = await triggerDailyReview(pool, triggerTime);
    expect(result.skipped_window).toBe(false);
    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('createCodeReviewTask 中途失败时被 catch 捕获', async () => {
    const triggerTime = new Date('2026-02-24T02:00:00Z');
    const pool = {
      query: vi.fn()
        // getActiveRepoPaths 成功
        .mockResolvedValueOnce({ rows: [{ repo_path: '/repo/a' }] })
        // hasTodayReview -> false
        .mockResolvedValueOnce({ rows: [] })
        // INSERT 失败
        .mockRejectedValueOnce(new Error('INSERT constraint violation')),
    };

    // triggerDailyReview 内部 try/catch 应捕获错误
    const result = await triggerDailyReview(pool, triggerTime);
    expect(result.skipped_window).toBe(false);
    // 错误被 catch 住，triggered 和 skipped 保持为初始值
    expect(result.triggered).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('不传 now 参数时使用当前时间（不抛错）', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    // 不传 now，函数应该使用 new Date()
    const result = await triggerDailyReview(pool);
    expect(typeof result.triggered).toBe('number');
    expect(typeof result.skipped_window).toBe('boolean');
  });
});

// ============================================================
// triggerContractScan
// ============================================================
describe('triggerContractScan', () => {
  it('非触发窗口直接跳过', async () => {
    const pool = { query: vi.fn() };
    const notTriggerTime = new Date('2026-03-05T10:00:00Z');
    const result = await triggerContractScan(pool, notTriggerTime);
    expect(result.skipped_window).toBe(true);
    expect(result.skipped_today).toBe(false);
    expect(result.triggered).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('今天已运行过，跳过', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'existing' }] }) };
    const triggerTime = new Date('2026-03-05T03:01:00Z');
    const result = await triggerContractScan(pool, triggerTime);
    expect(result.skipped_window).toBe(false);
    expect(result.skipped_today).toBe(true);
    expect(result.triggered).toBe(false);
  });

  it('触发窗口内且今天未运行，启动扫描脚本', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const triggerTime = new Date('2026-03-05T03:02:00Z');

    const mockChild = { unref: vi.fn() };
    const mockSpawn = vi.fn().mockReturnValue(mockChild);

    const result = await triggerContractScan(pool, triggerTime, mockSpawn);
    expect(result.skipped_window).toBe(false);
    expect(result.skipped_today).toBe(false);
    expect(result.triggered).toBe(true);

    // 验证 spawn 调用参数
    expect(mockSpawn).toHaveBeenCalledOnce();
    const [cmd, args, opts] = mockSpawn.mock.calls[0];
    expect(cmd).toBe('node');
    expect(args[0]).toContain('run-contract-scan.mjs');
    expect(opts.detached).toBe(true);
    expect(opts.stdio).toBe('ignore');

    // 验证 child.unref 被调用（fire-and-forget）
    expect(mockChild.unref).toHaveBeenCalledOnce();
  });

  it('去重检查 DB 失败时仍然继续触发', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('DB down')) };
    const triggerTime = new Date('2026-03-05T03:00:00Z');

    const mockChild = { unref: vi.fn() };
    const mockSpawn = vi.fn().mockReturnValue(mockChild);

    const result = await triggerContractScan(pool, triggerTime, mockSpawn);
    expect(result.triggered).toBe(true);
    expect(mockSpawn).toHaveBeenCalledOnce();
  });

  it('child 没有 unref 方法时不抛错', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const triggerTime = new Date('2026-03-05T03:00:00Z');

    // 模拟没有 unref 方法的 child 对象
    const mockChild = {};
    const mockSpawn = vi.fn().mockReturnValue(mockChild);

    const result = await triggerContractScan(pool, triggerTime, mockSpawn);
    expect(result.triggered).toBe(true);
  });

  it('不传 now 参数时使用当前时间（不抛错）', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await triggerContractScan(pool);
    // 根据当前时间决定是否在窗口内
    expect(typeof result.triggered).toBe('boolean');
  });
});
