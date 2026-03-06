/**
 * task-generator-scheduler 单元测试
 *
 * 覆盖所有导出函数：
 *   triggerCodeQualityScan, getScannerStatus
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// ─── vi.hoisted：在 vi.mock factory 里用到的 mock 必须用 hoisted 声明 ────────
const mockRunScan = vi.hoisted(() => vi.fn());
const mockGenerateTasks = vi.hoisted(() => vi.fn());
const mockGetScanners = vi.hoisted(() => vi.fn());
const mockGetLastScanTime = vi.hoisted(() => vi.fn());
const mockShouldScan = vi.hoisted(() => vi.fn());

// child_process.exec mock（callback 风格，promisify 可以正常包装它）
const mockExecCb = vi.hoisted(() => vi.fn((cmd, opts, cb) => {
  const callback = typeof opts === 'function' ? opts : cb;
  callback(null, { stdout: '', stderr: '' });
}));

// Mock task-generators/index.js 中的 getScheduler
vi.mock('../task-generators/index.js', () => ({
  getScheduler: vi.fn(() => ({
    runScan: mockRunScan,
    generateTasks: mockGenerateTasks,
    getScanners: mockGetScanners,
    getLastScanTime: mockGetLastScanTime,
    shouldScan: mockShouldScan,
  })),
}));

// Mock child_process
vi.mock('child_process', () => ({
  exec: mockExecCb,
}));

// 被测模块：动态 import，每次 beforeEach 重新加载以重置模块级 lastScanDate 状态
let triggerCodeQualityScan;
let getScannerStatus;

// ─── 辅助：构造假任务数据 ──────────────────────────────────────────────────────

const makeIssue = (id, severity = 'medium', modulePath = `src/module-${id}.js`) => ({
  id: `issue-${id}`,
  severity,
  module_path: modulePath,
  scanner: 'CoverageScanner',
  message: `Issue ${id}`,
});

const makeTask = (id) => ({
  id: `task-${id}`,
  title: `Fix issue ${id}`,
});

// ─── 构造假的 pg pool ─────────────────────────────────────────────────────────

const makePool = (returnedId = 'db-task-id-1') => ({
  query: vi.fn().mockResolvedValue({ rows: [{ id: returnedId }] }),
});

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe('task-generator-scheduler', () => {
  beforeEach(async () => {
    // 重置所有 mock
    mockRunScan.mockReset();
    mockGenerateTasks.mockReset();
    mockGetScanners.mockReset();
    mockGetLastScanTime.mockReset();
    mockShouldScan.mockReset();
    mockExecCb.mockReset();
    // 默认 exec 成功
    mockExecCb.mockImplementation((cmd, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(null, { stdout: '', stderr: '' });
    });

    // 使用假定时器，并固定 Date 为 "今天"
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'],
    });
    vi.setSystemTime(new Date('2026-03-06T10:00:00Z'));

    // 重新加载模块以重置 lastScanDate 等模块级状态
    vi.resetModules();
    const mod = await import('../task-generator-scheduler.js');
    triggerCodeQualityScan = mod.triggerCodeQualityScan;
    getScannerStatus = mod.getScannerStatus;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================
  // triggerCodeQualityScan
  // ============================================================

  describe('triggerCodeQualityScan', () => {
    // ── 正常路径：有 issue，生成任务 ──────────────────────────────

    it('首次扫描：runScan 返回 issues，generateTasks 被调用，返回 triggered:true', async () => {
      const pool = makePool('task-id-1');
      const issues = [makeIssue(1, 'high'), makeIssue(2, 'medium')];
      const tasks = [makeTask(1), makeTask(2)];

      mockRunScan.mockResolvedValue(issues);
      mockGenerateTasks.mockResolvedValue(tasks);

      const result = await triggerCodeQualityScan(pool);

      expect(result.triggered).toBe(true);
      expect(result.issues).toBe(2);
      expect(result.tasks).toBe(2);
      expect(mockRunScan).toHaveBeenCalledOnce();
      expect(mockGenerateTasks).toHaveBeenCalledOnce();
    });

    it('generateTasks 回调写入数据库：pool.query 被调用，参数包含正确字段', async () => {
      const pool = makePool('db-id-99');
      const issue = makeIssue(1, 'high');
      const taskData = {
        title: 'Fix coverage',
        description: 'Increase test coverage',
        priority: 'P0',
        tags: ['coverage'],
        metadata: { module: 'src/foo.js' },
      };

      mockRunScan.mockResolvedValue([issue]);
      // 模拟 generateTasks 触发 createTaskFn 回调
      mockGenerateTasks.mockImplementation(async (_issues, createTaskFn) => {
        await createTaskFn(taskData);
        return [{ id: 'task-gen-1', title: taskData.title }];
      });

      await triggerCodeQualityScan(pool);

      expect(pool.query).toHaveBeenCalledOnce();
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO tasks');
      expect(params[0]).toBe('Fix coverage');
      expect(params[1]).toBe('Increase test coverage');
      expect(params[2]).toBe('P0');
      expect(params[3]).toBe('queued');
      expect(params[4]).toEqual(['coverage']);
      expect(params[5]).toEqual({ module: 'src/foo.js' });
    });

    it('createTaskFn 中 priority 缺省时使用 P1', async () => {
      const pool = makePool();
      const issue = makeIssue(1);
      const taskData = { title: 'No priority task', description: 'desc' };

      mockRunScan.mockResolvedValue([issue]);
      mockGenerateTasks.mockImplementation(async (_issues, createTaskFn) => {
        await createTaskFn(taskData);
        return [{ id: 'task-x' }];
      });

      await triggerCodeQualityScan(pool);

      const params = pool.query.mock.calls[0][1];
      expect(params[2]).toBe('P1');
    });

    it('createTaskFn 中 tags/metadata 缺省时使用空值', async () => {
      const pool = makePool();
      const issue = makeIssue(1);
      const taskData = { title: 'Minimal task', description: 'desc' };

      mockRunScan.mockResolvedValue([issue]);
      mockGenerateTasks.mockImplementation(async (_issues, createTaskFn) => {
        await createTaskFn(taskData);
        return [{ id: 'task-y' }];
      });

      await triggerCodeQualityScan(pool);

      const params = pool.query.mock.calls[0][1];
      expect(params[4]).toEqual([]);
      expect(params[5]).toEqual({});
    });

    it('createTaskFn 回调返回数据库生成的 id', async () => {
      const pool = makePool('returned-id-42');
      const issue = makeIssue(1);
      let capturedId;

      mockRunScan.mockResolvedValue([issue]);
      mockGenerateTasks.mockImplementation(async (_issues, createTaskFn) => {
        capturedId = await createTaskFn({ title: 'T', description: 'D' });
        return [{ id: capturedId }];
      });

      await triggerCodeQualityScan(pool);

      expect(capturedId).toBe('returned-id-42');
    });

    // ── issues 为空 ───────────────────────────────────────────────

    it('runScan 返回空数组时：不调用 generateTasks，返回 triggered:true issues:0 tasks:0', async () => {
      const pool = makePool();
      mockRunScan.mockResolvedValue([]);

      const result = await triggerCodeQualityScan(pool);

      expect(result).toEqual({ triggered: true, issues: 0, tasks: 0 });
      expect(mockGenerateTasks).not.toHaveBeenCalled();
      expect(pool.query).not.toHaveBeenCalled();
    });

    // ── 每日去重：同一天第二次调用 ──────────────────────────────────

    it('同一天内第二次调用返回 triggered:false reason:already_scanned_today', async () => {
      const pool = makePool();
      mockRunScan.mockResolvedValue([]);

      // 第一次调用（触发 lastScanDate 写入）
      await triggerCodeQualityScan(pool);
      // 第二次调用，日期未变
      const result = await triggerCodeQualityScan(pool);

      expect(result).toEqual({ triggered: false, reason: 'already_scanned_today' });
      expect(mockRunScan).toHaveBeenCalledOnce(); // 只扫描一次
    });

    it('切换到新的一天后，允许再次扫描', async () => {
      const pool = makePool();
      mockRunScan.mockResolvedValue([]);

      // 第一天
      vi.setSystemTime(new Date('2026-03-06T23:59:00Z'));
      await triggerCodeQualityScan(pool);

      // 切换到第二天
      vi.setSystemTime(new Date('2026-03-07T00:01:00Z'));
      mockRunScan.mockResolvedValue([]);
      const result = await triggerCodeQualityScan(pool);

      // 不应该是 already_scanned_today
      expect(result.reason).not.toBe('already_scanned_today');
      expect(mockRunScan).toHaveBeenCalledTimes(2);
    });

    // ── 错误处理 ──────────────────────────────────────────────────

    it('runScan 抛出异常时返回 triggered:false error:message', async () => {
      const pool = makePool();
      mockRunScan.mockRejectedValue(new Error('scan failed'));

      const result = await triggerCodeQualityScan(pool);

      expect(result.triggered).toBe(false);
      expect(result.error).toBe('scan failed');
    });

    it('generateTasks 抛出异常时返回 triggered:false error:message', async () => {
      // 需要用新日期避免 already_scanned_today（上面测试可能污染了状态）
      vi.setSystemTime(new Date('2026-03-08T10:00:00Z'));
      const pool = makePool();
      mockRunScan.mockResolvedValue([makeIssue(1)]);
      mockGenerateTasks.mockRejectedValue(new Error('generate failed'));

      const result = await triggerCodeQualityScan(pool);

      expect(result.triggered).toBe(false);
      expect(result.error).toBe('generate failed');
    });

    it('pool.query 失败时 error 被捕获，返回 triggered:false', async () => {
      vi.setSystemTime(new Date('2026-03-09T10:00:00Z'));
      const pool = { query: vi.fn().mockRejectedValue(new Error('db write error')) };
      const issue = makeIssue(1);

      mockRunScan.mockResolvedValue([issue]);
      mockGenerateTasks.mockImplementation(async (_issues, createTaskFn) => {
        await createTaskFn({ title: 'T', description: 'D' });
        return [];
      });

      const result = await triggerCodeQualityScan(pool);

      expect(result.triggered).toBe(false);
      expect(result.error).toBe('db write error');
    });

    // ── 返回结构：taskIds 过滤 falsy ───────────────────────────────

    it('taskIds 只包含非 falsy 的 id', async () => {
      vi.setSystemTime(new Date('2026-03-10T10:00:00Z'));
      const pool = makePool();
      const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
      // 返回含 undefined id 的任务（DB insert 返回空 rows 时 rows[0]?.id = undefined）
      const tasks = [{ id: 'valid-id' }, { id: undefined }, { id: null }];

      mockRunScan.mockResolvedValue(issues);
      mockGenerateTasks.mockResolvedValue(tasks);

      const result = await triggerCodeQualityScan(pool);

      expect(result.taskIds).toEqual(['valid-id']);
      expect(result.tasks).toBe(3); // tasks.length 含 falsy
    });

    it('多个 issues 时 taskIds 包含所有有效 id', async () => {
      vi.setSystemTime(new Date('2026-03-11T10:00:00Z'));
      const pool = makePool();
      const issues = [makeIssue(1), makeIssue(2)];
      const tasks = [{ id: 'id-a' }, { id: 'id-b' }];

      mockRunScan.mockResolvedValue(issues);
      mockGenerateTasks.mockResolvedValue(tasks);

      const result = await triggerCodeQualityScan(pool);

      expect(result.taskIds).toEqual(['id-a', 'id-b']);
      expect(result.triggered).toBe(true);
      expect(result.issues).toBe(2);
      expect(result.tasks).toBe(2);
    });

    // ── coverage 自动生成 ──────────────────────────────────────────

    it('扫描前先调用 npx vitest run --coverage 生成 coverage 报告', async () => {
      vi.setSystemTime(new Date('2026-03-12T10:00:00Z'));
      const pool = makePool();
      mockRunScan.mockResolvedValue([]);

      await triggerCodeQualityScan(pool);

      expect(mockExecCb).toHaveBeenCalledOnce();
      const [cmd] = mockExecCb.mock.calls[0];
      expect(cmd).toBe('npx vitest run --coverage');
    });

    it('coverage 生成时 cwd 为 packages/brain 绝对路径', async () => {
      vi.setSystemTime(new Date('2026-03-13T10:00:00Z'));
      const pool = makePool();
      mockRunScan.mockResolvedValue([]);

      await triggerCodeQualityScan(pool);

      const [, opts] = mockExecCb.mock.calls[0];
      expect(opts.cwd).toContain('packages/brain');
      expect(path.isAbsolute(opts.cwd)).toBe(true);
    });

    it('coverage 生成失败时扫描仍然继续（降级策略）', async () => {
      vi.setSystemTime(new Date('2026-03-14T10:00:00Z'));
      const pool = makePool();

      // exec 失败
      mockExecCb.mockImplementation((cmd, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        callback(new Error('vitest exited with code 1'));
      });

      mockRunScan.mockResolvedValue([]);

      const result = await triggerCodeQualityScan(pool);

      // 扫描仍然执行
      expect(mockRunScan).toHaveBeenCalledOnce();
      expect(result.triggered).toBe(true);
    });

    it('coverage 生成超时后扫描仍然继续', async () => {
      vi.setSystemTime(new Date('2026-03-15T10:00:00Z'));
      const pool = makePool();

      mockExecCb.mockImplementation((cmd, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        const err = new Error('Command timed out');
        err.killed = true;
        callback(err);
      });

      mockRunScan.mockResolvedValue([]);

      const result = await triggerCodeQualityScan(pool);

      expect(mockRunScan).toHaveBeenCalledOnce();
      expect(result.triggered).toBe(true);
    });

    it('coverage 生成成功后才调用 runScan（顺序正确）', async () => {
      vi.setSystemTime(new Date('2026-03-16T10:00:00Z'));
      const pool = makePool();
      const callOrder = [];

      mockExecCb.mockImplementation((cmd, opts, cb) => {
        callOrder.push('exec');
        const callback = typeof opts === 'function' ? opts : cb;
        callback(null, { stdout: '', stderr: '' });
      });
      mockRunScan.mockImplementation(async () => {
        callOrder.push('runScan');
        return [];
      });

      await triggerCodeQualityScan(pool);

      expect(callOrder).toEqual(['exec', 'runScan']);
    });
  });

  // ============================================================
  // getScannerStatus
  // ============================================================

  describe('getScannerStatus', () => {
    it('返回 scanners / lastScanTime / shouldScan 三个字段', () => {
      const scanners = [
        { name: 'CoverageScanner', threshold: 80 },
        { name: 'ComplexityScanner', threshold: 10 },
      ];
      const lastScanTime = new Date('2026-03-06T08:00:00Z');

      mockGetScanners.mockReturnValue(scanners);
      mockGetLastScanTime.mockReturnValue(lastScanTime);
      mockShouldScan.mockReturnValue(false);

      const result = getScannerStatus();

      expect(result).toEqual({
        scanners,
        lastScanTime,
        shouldScan: false,
      });
    });

    it('shouldScan 为 true 时正确透传', () => {
      mockGetScanners.mockReturnValue([]);
      mockGetLastScanTime.mockReturnValue(null);
      mockShouldScan.mockReturnValue(true);

      const result = getScannerStatus();

      expect(result.shouldScan).toBe(true);
      expect(result.lastScanTime).toBeNull();
    });

    it('scanners 为空数组时正确返回', () => {
      mockGetScanners.mockReturnValue([]);
      mockGetLastScanTime.mockReturnValue(null);
      mockShouldScan.mockReturnValue(true);

      const result = getScannerStatus();

      expect(result.scanners).toEqual([]);
    });

    it('调用时 getScheduler 方法全部被调用一次', () => {
      mockGetScanners.mockReturnValue([{ name: 'UntestedScanner', threshold: 0 }]);
      mockGetLastScanTime.mockReturnValue(new Date());
      mockShouldScan.mockReturnValue(false);

      getScannerStatus();

      expect(mockGetScanners).toHaveBeenCalledOnce();
      expect(mockGetLastScanTime).toHaveBeenCalledOnce();
      expect(mockShouldScan).toHaveBeenCalledOnce();
    });

    it('多次调用返回结果相互独立', () => {
      mockGetScanners.mockReturnValueOnce([{ name: 'S1', threshold: 70 }])
                     .mockReturnValueOnce([{ name: 'S2', threshold: 60 }]);
      mockGetLastScanTime.mockReturnValue(null);
      mockShouldScan.mockReturnValue(true);

      const r1 = getScannerStatus();
      const r2 = getScannerStatus();

      expect(r1.scanners[0].name).toBe('S1');
      expect(r2.scanners[0].name).toBe('S2');
    });
  });
});
