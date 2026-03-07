/**
 * task-generator 去重机制测试
 *
 * 覆盖：
 *   - triggerCodeQualityScan 活跃任务去重查询
 *   - scan_results 7 天历史查询
 *   - generateTasks(existingTasks) 过滤逻辑
 *   - DB 查询失败时降级
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── vi.hoisted ────────────────────────────────────────────────────────────
const mockRunScan = vi.hoisted(() => vi.fn());
const mockGenerateTasks = vi.hoisted(() => vi.fn());
const mockGetScanners = vi.hoisted(() => vi.fn());
const mockGetLastScanTime = vi.hoisted(() => vi.fn());
const mockShouldScan = vi.hoisted(() => vi.fn());

const mockExecCb = vi.hoisted(() => vi.fn((cmd, opts, cb) => {
  const callback = typeof opts === 'function' ? opts : cb;
  callback(null, { stdout: '', stderr: '' });
}));

vi.mock('../task-generators/index.js', () => ({
  getScheduler: vi.fn(() => ({
    runScan: mockRunScan,
    generateTasks: mockGenerateTasks,
    getScanners: mockGetScanners,
    getLastScanTime: mockGetLastScanTime,
    shouldScan: mockShouldScan,
  })),
}));

vi.mock('child_process', () => ({
  exec: mockExecCb,
}));

let triggerCodeQualityScan;

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

const makeIssue = (modulePath, issueType = 'low_coverage', severity = 'medium', scanner = 'CoverageScanner') => ({
  module_path: modulePath,
  issue_type: issueType,
  severity,
  scanner,
});

/**
 * 构造 pool mock，支持多次 query 的顺序返回
 * @param {Array} responses 每次 query 的返回值（按顺序）
 */
const makePool = (responses = []) => {
  let callIndex = 0;
  return {
    query: vi.fn().mockImplementation(() => {
      const resp = responses[callIndex] ?? { rows: [] };
      callIndex++;
      return Promise.resolve(resp);
    }),
  };
};

// ─── 测试 ──────────────────────────────────────────────────────────────────

describe('task-generator 去重机制', () => {
  beforeEach(async () => {
    mockRunScan.mockReset();
    mockGenerateTasks.mockReset();
    mockGetScanners.mockReset();
    mockGetLastScanTime.mockReset();
    mockShouldScan.mockReset();
    mockExecCb.mockReset();
    mockExecCb.mockImplementation((cmd, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(null, { stdout: '', stderr: '' });
    });

    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'],
    });
    vi.setSystemTime(new Date('2026-03-06T10:00:00Z'));

    vi.resetModules();
    const mod = await import('../task-generator-scheduler.js');
    triggerCodeQualityScan = mod.triggerCodeQualityScan;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================
  // 活跃任务去重（tasks 表查询）
  // ============================================================

  describe('活跃任务去重', () => {
    it('有活跃任务时 generateTasks 接收到非空 existingTasks', async () => {
      const activeMetadata = { module_path: 'src/tick.js', issue_type: 'low_coverage', scanner: 'coverage' };

      // pool.query 调用顺序：
      // 1. SELECT metadata FROM tasks（去重查询 - 活跃任务）
      // 2. SELECT ... FROM scan_results（去重查询 - 历史）
      // 3. INSERT INTO tasks（generateTasks 回调）
      const pool = makePool([
        { rows: [{ metadata: activeMetadata }] }, // 活跃任务查询
        { rows: [] },                              // scan_results 历史查询
        { rows: [{ id: 'new-task-id' }] },         // INSERT（如果被调用）
      ]);

      mockRunScan.mockResolvedValue([makeIssue('src/tick.js', 'low_coverage')]);
      let capturedExistingTasks;
      mockGenerateTasks.mockImplementation(async (_issues, _fn, existingTasks) => {
        capturedExistingTasks = existingTasks;
        return [];
      });

      await triggerCodeQualityScan(pool);

      expect(capturedExistingTasks).toBeDefined();
      expect(capturedExistingTasks.length).toBeGreaterThan(0);
      expect(capturedExistingTasks[0]).toMatchObject({
        module_path: 'src/tick.js',
        issue_type: 'low_coverage',
      });
    });

    it('无活跃任务时 existingTasks 为空数组', async () => {
      const pool = makePool([
        { rows: [] }, // 活跃任务：空
        { rows: [] }, // scan_results：空
        { rows: [{ id: 'task-1' }] }, // INSERT
      ]);

      mockRunScan.mockResolvedValue([makeIssue('src/foo.js')]);
      let capturedExistingTasks;
      mockGenerateTasks.mockImplementation(async (_issues, _fn, existingTasks) => {
        capturedExistingTasks = existingTasks;
        return [];
      });

      await triggerCodeQualityScan(pool);

      expect(capturedExistingTasks).toEqual([]);
    });

    it('DB 查询失败时降级：existingTasks 为空，任务正常生成', async () => {
      const pool = {
        query: vi.fn()
          .mockRejectedValueOnce(new Error('DB connection failed')) // 去重查询失败
          .mockResolvedValue({ rows: [{ id: 'task-ok' }] }),        // INSERT 成功
      };

      mockRunScan.mockResolvedValue([makeIssue('src/bar.js')]);
      let capturedExistingTasks;
      mockGenerateTasks.mockImplementation(async (_issues, _fn, existingTasks) => {
        capturedExistingTasks = existingTasks;
        return [{ id: 'task-ok' }];
      });

      const result = await triggerCodeQualityScan(pool);

      // 降级：继续生成任务
      expect(result.triggered).toBe(true);
      expect(capturedExistingTasks).toEqual([]);
    });

    it('去重查询使用正确的 SQL（查 queued/in_progress + metadata 非空）', async () => {
      const pool = makePool([
        { rows: [] }, // 活跃任务
        { rows: [] }, // scan_results
        { rows: [{ id: 'x' }] },
      ]);

      mockRunScan.mockResolvedValue([makeIssue('src/x.js')]);
      mockGenerateTasks.mockResolvedValue([]);

      await triggerCodeQualityScan(pool);

      // 第一次 query 是活跃任务去重查询
      const firstCall = pool.query.mock.calls[0][0];
      expect(firstCall).toContain("status IN ('queued', 'in_progress')");
      expect(firstCall).toContain('metadata');
    });
  });

  // ============================================================
  // scan_results 7 天历史查询
  // ============================================================

  describe('scan_results 历史查询', () => {
    it('scan_results 历史查询包含 7 天时间窗口', async () => {
      const pool = makePool([
        { rows: [] }, // 活跃任务
        { rows: [] }, // scan_results
      ]);

      mockRunScan.mockResolvedValue([makeIssue('src/y.js')]);
      mockGenerateTasks.mockResolvedValue([]);

      await triggerCodeQualityScan(pool);

      // 第二次 query 是 scan_results 历史查询
      const secondCall = pool.query.mock.calls[1][0];
      expect(secondCall).toContain('scan_results');
      expect(secondCall).toContain('7 days');
    });

    it('scan_results 历史查询只跳过未完成任务（非 completed/failed/cancelled）', async () => {
      const pool = makePool([
        { rows: [] }, // 活跃任务：空
        { rows: [] }, // scan_results：空（模拟：对应任务已 completed）
      ]);

      mockRunScan.mockResolvedValue([makeIssue('src/recovered.js', 'low_coverage')]);
      let capturedExistingTasks;
      mockGenerateTasks.mockImplementation(async (_issues, _fn, existingTasks) => {
        capturedExistingTasks = existingTasks;
        return [];
      });

      await triggerCodeQualityScan(pool);

      // scan_results 查询返回空（completed 任务被 NOT IN 排除），existingTasks 仍为空
      expect(capturedExistingTasks).toEqual([]);
    });

    it('scan_results 返回未完成任务时加入 existingTasks', async () => {
      const pool = makePool([
        { rows: [] }, // 活跃任务：空
        { rows: [{ module_path: 'src/tick.js', issue_type: 'high_complexity' }] }, // scan_results 历史
      ]);

      mockRunScan.mockResolvedValue([makeIssue('src/tick.js', 'high_complexity')]);
      let capturedExistingTasks;
      mockGenerateTasks.mockImplementation(async (_issues, _fn, existingTasks) => {
        capturedExistingTasks = existingTasks;
        return [];
      });

      await triggerCodeQualityScan(pool);

      expect(capturedExistingTasks).toContainEqual({
        module_path: 'src/tick.js',
        issue_type: 'high_complexity',
      });
    });
  });

  // ============================================================
  // generateTasks existingTasks 过滤逻辑（scheduler.js 单元测试）
  // ============================================================

  describe('ScannerScheduler.generateTasks existingTasks 过滤', () => {
    let ScannerScheduler;
    let resetScheduler;

    beforeEach(async () => {
      vi.resetModules();
      const mod = await import('../task-generators/scheduler.js');
      ScannerScheduler = mod.default;
      resetScheduler = mod.resetScheduler;
    });

    afterEach(() => {
      resetScheduler?.();
    });

    const makeMockScanner = (name) => ({
      getName: () => name,
      generateTask: vi.fn().mockImplementation(async (issue) => ({
        title: `Fix ${issue.module_path}`,
        metadata: { module_path: issue.module_path, issue_type: issue.issue_type },
      })),
    });

    it('existingTasks 匹配时跳过 issue，不调用 generateTask', async () => {
      const scheduler = new ScannerScheduler({ maxTasksPerScan: 5 });
      const scanner = makeMockScanner('coverage');
      scheduler.registerScanner(scanner);

      const issues = [
        makeIssue('src/tick.js', 'low_coverage', 'medium', 'coverage'),
        makeIssue('src/new.js', 'low_coverage', 'medium', 'coverage'),
      ];
      const existingTasks = [
        { module_path: 'src/tick.js', issue_type: 'low_coverage' },
      ];

      const tasks = await scheduler.generateTasks(issues, vi.fn(), existingTasks);

      // src/tick.js 被跳过，只生成 src/new.js 的任务
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Fix src/new.js');
    });

    it('不同 module_path 的 issue 正常生成', async () => {
      const scheduler = new ScannerScheduler({ maxTasksPerScan: 5 });
      const scanner = makeMockScanner('coverage');
      scheduler.registerScanner(scanner);

      const issues = [
        makeIssue('src/a.js', 'low_coverage', 'medium', 'coverage'),
        makeIssue('src/b.js', 'low_coverage', 'medium', 'coverage'),
      ];
      const existingTasks = [
        { module_path: 'src/c.js', issue_type: 'low_coverage' }, // 不同路径
      ];

      const tasks = await scheduler.generateTasks(issues, vi.fn(), existingTasks);

      expect(tasks).toHaveLength(2);
    });

    it('existingTasks 为空时行为与不传参数相同', async () => {
      const scheduler = new ScannerScheduler({ maxTasksPerScan: 5 });
      const scanner = makeMockScanner('coverage');
      scheduler.registerScanner(scanner);

      const issues = [makeIssue('src/x.js', 'low_coverage', 'medium', 'coverage')];

      const tasksWithEmpty = await scheduler.generateTasks(issues, vi.fn(), []);
      const tasksWithUndefined = await scheduler.generateTasks(issues, vi.fn());

      expect(tasksWithEmpty).toHaveLength(1);
      expect(tasksWithUndefined).toHaveLength(1);
    });

    it('issue_type 不同时不被去重（module_path 相同但 issue_type 不同）', async () => {
      const scheduler = new ScannerScheduler({ maxTasksPerScan: 5 });
      const scanner = makeMockScanner('coverage');
      scheduler.registerScanner(scanner);

      const issues = [
        makeIssue('src/tick.js', 'high_complexity', 'medium', 'coverage'), // issue_type 不同
      ];
      const existingTasks = [
        { module_path: 'src/tick.js', issue_type: 'low_coverage' }, // 只有 low_coverage 存在
      ];

      const tasks = await scheduler.generateTasks(issues, vi.fn(), existingTasks);

      // high_complexity 不在去重集合中，应该正常生成
      expect(tasks).toHaveLength(1);
    });

    it('existingTasks 中 module_path 或 issue_type 缺失时被忽略（不影响正常 issue）', async () => {
      const scheduler = new ScannerScheduler({ maxTasksPerScan: 5 });
      const scanner = makeMockScanner('coverage');
      scheduler.registerScanner(scanner);

      const issues = [makeIssue('src/z.js', 'low_coverage', 'medium', 'coverage')];
      const existingTasks = [
        { module_path: 'src/z.js' }, // 缺少 issue_type，不会误命中
        null,                          // null 值，被过滤
      ];

      const tasks = await scheduler.generateTasks(issues, vi.fn(), existingTasks);

      // 不完整的 existingTasks 项被忽略，src/z.js 正常生成
      expect(tasks).toHaveLength(1);
    });

    it('全部 issues 被去重时返回空数组', async () => {
      const scheduler = new ScannerScheduler({ maxTasksPerScan: 5 });
      const scanner = makeMockScanner('coverage');
      scheduler.registerScanner(scanner);

      const issues = [makeIssue('src/a.js', 'low_coverage', 'medium', 'coverage')];
      const existingTasks = [{ module_path: 'src/a.js', issue_type: 'low_coverage' }];

      const tasks = await scheduler.generateTasks(issues, vi.fn(), existingTasks);

      expect(tasks).toHaveLength(0);
    });
  });
});
