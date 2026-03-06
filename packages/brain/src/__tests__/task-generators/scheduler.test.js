/**
 * scheduler.test.js
 *
 * 覆盖 ScannerScheduler 所有方法及导出函数：
 *   - constructor(options)
 *   - registerScanner(scanner)
 *   - initDefaultScanners()
 *   - runScan()
 *   - generateTasks(issues, createTaskFn)
 *   - getScanners()
 *   - getLastScanTime()
 *   - shouldScan()
 *   - getScheduler(options) - 单例
 *   - resetScheduler()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock 三个扫描器（initDefaultScanners 使用）───────────────────────────────
const mockCoverageScan = vi.hoisted(() => vi.fn());
const mockComplexityScan = vi.hoisted(() => vi.fn());
const mockUntestedScan = vi.hoisted(() => vi.fn());
const mockCoverageGetName = vi.hoisted(() => vi.fn(() => 'coverage'));
const mockComplexityGetName = vi.hoisted(() => vi.fn(() => 'complexity'));
const mockUntestedGetName = vi.hoisted(() => vi.fn(() => 'untested'));
const mockCoverageGetThreshold = vi.hoisted(() => vi.fn(() => ({})));
const mockComplexityGetThreshold = vi.hoisted(() => vi.fn(() => ({})));
const mockUntestedGetThreshold = vi.hoisted(() => vi.fn(() => ({})));
const mockCoverageGenerateTask = vi.hoisted(() => vi.fn());
const mockComplexityGenerateTask = vi.hoisted(() => vi.fn());
const mockUntestedGenerateTask = vi.hoisted(() => vi.fn());

vi.mock('../../task-generators/coverage-scanner.js', () => ({
  default: vi.fn(() => ({
    scan: mockCoverageScan,
    getName: mockCoverageGetName,
    getThreshold: mockCoverageGetThreshold,
    generateTask: mockCoverageGenerateTask,
  })),
}));

vi.mock('../../task-generators/complexity-scanner.js', () => ({
  default: vi.fn(() => ({
    scan: mockComplexityScan,
    getName: mockComplexityGetName,
    getThreshold: mockComplexityGetThreshold,
    generateTask: mockComplexityGenerateTask,
  })),
}));

vi.mock('../../task-generators/untested-scanner.js', () => ({
  default: vi.fn(() => ({
    scan: mockUntestedScan,
    getName: mockUntestedGetName,
    getThreshold: mockUntestedGetThreshold,
    generateTask: mockUntestedGenerateTask,
  })),
}));

// ─── 被测模块（动态 import，每次 beforeEach 重置单例）────────────────────────
let ScannerScheduler;
let getScheduler;
let resetScheduler;

describe('ScannerScheduler', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-06T10:00:00Z'));

    // 重置模块以清除单例状态
    vi.resetModules();
    const mod = await import('../../task-generators/scheduler.js');
    ScannerScheduler = mod.default;
    getScheduler = mod.getScheduler;
    resetScheduler = mod.resetScheduler;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================
  // constructor
  // ============================================================

  describe('constructor', () => {
    it('默认选项：scanInterval=24h，maxTasksPerScan=3', () => {
      const scheduler = new ScannerScheduler();
      expect(scheduler.options.scanInterval).toBe(24 * 60 * 60 * 1000);
      expect(scheduler.options.maxTasksPerScan).toBe(3);
    });

    it('自定义 scanInterval', () => {
      const scheduler = new ScannerScheduler({ scanInterval: 1000 });
      expect(scheduler.options.scanInterval).toBe(1000);
    });

    it('自定义 maxTasksPerScan', () => {
      const scheduler = new ScannerScheduler({ maxTasksPerScan: 5 });
      expect(scheduler.options.maxTasksPerScan).toBe(5);
    });

    it('初始 scanners 为空数组', () => {
      const scheduler = new ScannerScheduler();
      expect(scheduler.scanners).toEqual([]);
    });

    it('初始 lastScanTime 为 null', () => {
      const scheduler = new ScannerScheduler();
      expect(scheduler.lastScanTime).toBeNull();
    });
  });

  // ============================================================
  // registerScanner
  // ============================================================

  describe('registerScanner', () => {
    it('注册扫描器后 scanners 数组增加', () => {
      const scheduler = new ScannerScheduler();
      const mockScanner = {
        getName: () => 'test-scanner',
        getThreshold: () => ({}),
        scan: vi.fn(),
        generateTask: vi.fn(),
      };

      scheduler.registerScanner(mockScanner);

      expect(scheduler.scanners).toHaveLength(1);
      expect(scheduler.scanners[0]).toBe(mockScanner);
    });

    it('多次注册多个扫描器', () => {
      const scheduler = new ScannerScheduler();
      const scanner1 = { getName: () => 'scanner1', getThreshold: () => ({}) };
      const scanner2 = { getName: () => 'scanner2', getThreshold: () => ({}) };

      scheduler.registerScanner(scanner1);
      scheduler.registerScanner(scanner2);

      expect(scheduler.scanners).toHaveLength(2);
    });
  });

  // ============================================================
  // initDefaultScanners
  // ============================================================

  describe('initDefaultScanners', () => {
    it('注册 3 个默认扫描器（coverage、complexity、untested）', () => {
      const scheduler = new ScannerScheduler();
      scheduler.initDefaultScanners();

      expect(scheduler.scanners).toHaveLength(3);
      const names = scheduler.scanners.map(s => s.getName());
      expect(names).toContain('coverage');
      expect(names).toContain('complexity');
      expect(names).toContain('untested');
    });
  });

  // ============================================================
  // runScan
  // ============================================================

  describe('runScan', () => {
    it('没有扫描器时返回空数组', async () => {
      const scheduler = new ScannerScheduler();
      const issues = await scheduler.runScan();

      expect(issues).toEqual([]);
    });

    it('聚合所有扫描器的结果', async () => {
      const scheduler = new ScannerScheduler();

      const mockScanner1 = {
        getName: () => 'scanner1',
        scan: vi.fn().mockResolvedValue([
          { module_path: 'src/a.js', issue_type: 'low_coverage', current_value: 20, target_value: 70 },
        ]),
      };
      const mockScanner2 = {
        getName: () => 'scanner2',
        scan: vi.fn().mockResolvedValue([
          { module_path: 'src/b.js', issue_type: 'high_complexity', current_value: 15, target_value: 10 },
        ]),
      };

      scheduler.registerScanner(mockScanner1);
      scheduler.registerScanner(mockScanner2);

      const issues = await scheduler.runScan();

      expect(issues).toHaveLength(2);
    });

    it('每个 issue 被添加 scanner 字段', async () => {
      const scheduler = new ScannerScheduler();

      const mockScanner = {
        getName: () => 'coverage',
        scan: vi.fn().mockResolvedValue([
          { module_path: 'src/foo.js', issue_type: 'low_coverage', current_value: 30, target_value: 70 },
        ]),
      };

      scheduler.registerScanner(mockScanner);
      const issues = await scheduler.runScan();

      expect(issues[0].scanner).toBe('coverage');
    });

    it('扫描后 lastScanTime 被更新', async () => {
      const scheduler = new ScannerScheduler();
      expect(scheduler.lastScanTime).toBeNull();

      await scheduler.runScan();

      expect(scheduler.lastScanTime).not.toBeNull();
      expect(scheduler.lastScanTime).toBeInstanceOf(Date);
    });

    it('某个扫描器抛出异常时不影响其他扫描器', async () => {
      const scheduler = new ScannerScheduler();

      const failingScanner = {
        getName: () => 'failing',
        scan: vi.fn().mockRejectedValue(new Error('Scan failed')),
      };
      const successScanner = {
        getName: () => 'success',
        scan: vi.fn().mockResolvedValue([
          { module_path: 'src/ok.js', issue_type: 'no_test', current_value: 0, target_value: 1 },
        ]),
      };

      scheduler.registerScanner(failingScanner);
      scheduler.registerScanner(successScanner);

      const issues = await scheduler.runScan();

      expect(issues).toHaveLength(1);
      expect(issues[0].module_path).toBe('src/ok.js');
    });
  });

  // ============================================================
  // generateTasks
  // ============================================================

  describe('generateTasks', () => {
    it('没有 issues 时返回空数组', async () => {
      const scheduler = new ScannerScheduler();
      const createTaskFn = vi.fn();

      const tasks = await scheduler.generateTasks([], createTaskFn);

      expect(tasks).toEqual([]);
    });

    it('issues 按 severity 排序（high > medium > low）', async () => {
      const scheduler = new ScannerScheduler();

      const mockScanner = {
        getName: () => 'test',
        generateTask: vi.fn().mockImplementation(async (issue) => ({ title: `Fix ${issue.module_path}` })),
      };
      scheduler.registerScanner(mockScanner);

      const issues = [
        { module_path: 'a.js', severity: 'low', scanner: 'test' },
        { module_path: 'b.js', severity: 'high', scanner: 'test' },
        { module_path: 'c.js', severity: 'medium', scanner: 'test' },
      ];

      const tasks = await scheduler.generateTasks(issues, vi.fn());

      // 最多 3 个任务，按 high/medium/low 排序
      expect(tasks[0].title).toBe('Fix b.js');
      expect(tasks[1].title).toBe('Fix c.js');
      expect(tasks[2].title).toBe('Fix a.js');
    });

    it('最多生成 maxTasksPerScan 个任务', async () => {
      const scheduler = new ScannerScheduler({ maxTasksPerScan: 2 });

      const mockScanner = {
        getName: () => 'test',
        generateTask: vi.fn().mockImplementation(async (issue) => ({ title: `Fix ${issue.module_path}` })),
      };
      scheduler.registerScanner(mockScanner);

      const issues = [
        { module_path: 'a.js', severity: 'high', scanner: 'test' },
        { module_path: 'b.js', severity: 'high', scanner: 'test' },
        { module_path: 'c.js', severity: 'high', scanner: 'test' },
      ];

      const tasks = await scheduler.generateTasks(issues, vi.fn());

      expect(tasks).toHaveLength(2);
    });

    it('找不到对应 scanner 时跳过该 issue', async () => {
      const scheduler = new ScannerScheduler();

      const issues = [
        { module_path: 'a.js', severity: 'high', scanner: 'nonexistent' },
      ];

      const tasks = await scheduler.generateTasks(issues, vi.fn());

      expect(tasks).toHaveLength(0);
    });

    it('generateTask 抛出异常时不影响其他 issue', async () => {
      const scheduler = new ScannerScheduler();

      const failScanner = {
        getName: () => 'fail',
        generateTask: vi.fn().mockRejectedValue(new Error('Generate failed')),
      };
      const okScanner = {
        getName: () => 'ok',
        generateTask: vi.fn().mockResolvedValue({ title: 'OK task' }),
      };

      scheduler.registerScanner(failScanner);
      scheduler.registerScanner(okScanner);

      const issues = [
        { module_path: 'a.js', severity: 'high', scanner: 'fail' },
        { module_path: 'b.js', severity: 'medium', scanner: 'ok' },
      ];

      const tasks = await scheduler.generateTasks(issues, vi.fn());

      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('OK task');
    });

    it('severity 缺失时按 low 处理', async () => {
      const scheduler = new ScannerScheduler({ maxTasksPerScan: 3 });

      const mockScanner = {
        getName: () => 'test',
        generateTask: vi.fn().mockImplementation(async (issue) => ({ title: `Fix ${issue.module_path}` })),
      };
      scheduler.registerScanner(mockScanner);

      const issues = [
        { module_path: 'a.js', scanner: 'test' }, // 无 severity
        { module_path: 'b.js', severity: 'high', scanner: 'test' },
      ];

      const tasks = await scheduler.generateTasks(issues, vi.fn());

      // b.js (high) 应该排在 a.js (默认 low) 之前
      expect(tasks[0].title).toBe('Fix b.js');
    });
  });

  // ============================================================
  // getScanners
  // ============================================================

  describe('getScanners', () => {
    it('返回扫描器的 name 和 threshold 列表', () => {
      const scheduler = new ScannerScheduler();

      const mockScanner = {
        getName: () => 'test',
        getThreshold: () => ({ min: 70 }),
      };
      scheduler.registerScanner(mockScanner);

      const result = scheduler.getScanners();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test');
      expect(result[0].threshold).toEqual({ min: 70 });
    });

    it('没有扫描器时返回空数组', () => {
      const scheduler = new ScannerScheduler();
      expect(scheduler.getScanners()).toEqual([]);
    });
  });

  // ============================================================
  // getLastScanTime
  // ============================================================

  describe('getLastScanTime', () => {
    it('初始时返回 null', () => {
      const scheduler = new ScannerScheduler();
      expect(scheduler.getLastScanTime()).toBeNull();
    });

    it('runScan 后返回 Date 对象', async () => {
      const scheduler = new ScannerScheduler();
      await scheduler.runScan();

      const lastTime = scheduler.getLastScanTime();
      expect(lastTime).toBeInstanceOf(Date);
    });
  });

  // ============================================================
  // shouldScan
  // ============================================================

  describe('shouldScan', () => {
    it('初始时（无上次扫描）返回 true', () => {
      const scheduler = new ScannerScheduler();
      expect(scheduler.shouldScan()).toBe(true);
    });

    it('刚扫描完时（未到间隔）返回 false', async () => {
      const scheduler = new ScannerScheduler({ scanInterval: 60 * 60 * 1000 }); // 1h
      await scheduler.runScan();

      // 扫描后立即检查，未到间隔
      expect(scheduler.shouldScan()).toBe(false);
    });

    it('超过扫描间隔后返回 true', async () => {
      const scheduler = new ScannerScheduler({ scanInterval: 1000 }); // 1s
      await scheduler.runScan();

      // 时间前进 2 秒
      vi.advanceTimersByTime(2000);

      expect(scheduler.shouldScan()).toBe(true);
    });
  });

  // ============================================================
  // getScheduler（单例）
  // ============================================================

  describe('getScheduler', () => {
    it('首次调用返回 ScannerScheduler 实例', () => {
      const scheduler = getScheduler();
      expect(scheduler).toBeInstanceOf(ScannerScheduler);
    });

    it('多次调用返回同一实例（单例）', () => {
      const scheduler1 = getScheduler();
      const scheduler2 = getScheduler();
      expect(scheduler1).toBe(scheduler2);
    });

    it('单例包含 3 个默认扫描器', () => {
      const scheduler = getScheduler();
      expect(scheduler.getScanners()).toHaveLength(3);
    });
  });

  // ============================================================
  // resetScheduler
  // ============================================================

  describe('resetScheduler', () => {
    it('重置后 getScheduler 返回新实例', () => {
      const scheduler1 = getScheduler();
      resetScheduler();
      const scheduler2 = getScheduler();

      expect(scheduler1).not.toBe(scheduler2);
    });

    it('重置后新实例是有效的 ScannerScheduler', () => {
      resetScheduler();
      const scheduler = getScheduler();
      expect(scheduler).toBeInstanceOf(ScannerScheduler);
    });
  });
});
