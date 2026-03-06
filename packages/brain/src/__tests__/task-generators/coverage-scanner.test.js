/**
 * coverage-scanner.test.js
 *
 * 覆盖 CoverageScanner 所有方法：
 *   - constructor(options)
 *   - scan()
 *   - generateTask(issue)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock fs 和 path（scan 方法使用）─────────────────────────────────────────
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

// ─── 导入被测模块 ────────────────────────────────────────────────────────────
import CoverageScanner from '../../task-generators/coverage-scanner.js';

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe('CoverageScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // constructor
  // ============================================================

  describe('constructor', () => {
    it('默认选项：minCoverage=70，coverageDir=./coverage，sourceDir 有默认值', () => {
      const scanner = new CoverageScanner();
      expect(scanner.getName()).toBe('coverage');
      const threshold = scanner.getThreshold();
      expect(threshold.minCoverage).toBe(70);
    });

    it('自定义 minCoverage', () => {
      const scanner = new CoverageScanner({ minCoverage: 80 });
      expect(scanner.getThreshold().minCoverage).toBe(80);
    });

    it('自定义 coverageDir 被传入 options', () => {
      const scanner = new CoverageScanner({ coverageDir: '/custom/coverage' });
      expect(scanner.options.coverageDir).toBe('/custom/coverage');
    });

    it('自定义 sourceDir 被传入 options', () => {
      const scanner = new CoverageScanner({ sourceDir: '/custom/src' });
      expect(scanner.options.sourceDir).toBe('/custom/src');
    });

    it('name 固定为 coverage', () => {
      const scanner = new CoverageScanner();
      expect(scanner.name).toBe('coverage');
    });
  });

  // ============================================================
  // scan
  // ============================================================

  describe('scan', () => {
    it('覆盖率报告不存在时返回空数组', async () => {
      mockExistsSync.mockReturnValue(false);

      const scanner = new CoverageScanner();
      const issues = await scanner.scan();

      expect(issues).toEqual([]);
    });

    it('覆盖率报告存在且有低覆盖率文件时返回 issues', async () => {
      mockExistsSync.mockReturnValue(true);

      const sourceDir = './packages/brain/src';
      const coverageData = {
        [`${sourceDir}/tick.js`]: { lines: { pct: 30 } },
        [`${sourceDir}/executor.js`]: { lines: { pct: 80 } },
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(coverageData));

      const scanner = new CoverageScanner({ minCoverage: 70 });
      const issues = await scanner.scan();

      expect(issues).toHaveLength(1);
      expect(issues[0].module_path).toContain('tick.js');
      expect(issues[0].issue_type).toBe('low_coverage');
      expect(issues[0].current_value).toBe(30);
      expect(issues[0].target_value).toBe(70);
    });

    it('severity: 覆盖率 < 50% 为 high，否则为 medium', async () => {
      mockExistsSync.mockReturnValue(true);

      const sourceDir = './packages/brain/src';
      const coverageData = {
        [`${sourceDir}/low.js`]: { lines: { pct: 20 } },
        [`${sourceDir}/medium.js`]: { lines: { pct: 60 } },
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(coverageData));

      const scanner = new CoverageScanner({ minCoverage: 70 });
      const issues = await scanner.scan();

      const lowIssue = issues.find(i => i.module_path.includes('low.js'));
      const mediumIssue = issues.find(i => i.module_path.includes('medium.js'));

      expect(lowIssue.severity).toBe('high');
      expect(mediumIssue.severity).toBe('medium');
    });

    it('覆盖率 >= minCoverage 的文件不出现在 issues 中', async () => {
      mockExistsSync.mockReturnValue(true);

      const sourceDir = './packages/brain/src';
      const coverageData = {
        [`${sourceDir}/good.js`]: { lines: { pct: 90 } },
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(coverageData));

      const scanner = new CoverageScanner({ minCoverage: 70 });
      const issues = await scanner.scan();

      expect(issues).toHaveLength(0);
    });

    it('非源文件路径被跳过', async () => {
      mockExistsSync.mockReturnValue(true);

      const coverageData = {
        '/node_modules/foo/index.js': { lines: { pct: 10 } },
        '/some/other/path/bar.js': { lines: { pct: 5 } },
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(coverageData));

      const scanner = new CoverageScanner({ sourceDir: './packages/brain/src' });
      const issues = await scanner.scan();

      expect(issues).toHaveLength(0);
    });

    it('lines.pct 缺失时默认为 0（低于阈值）', async () => {
      mockExistsSync.mockReturnValue(true);

      const sourceDir = './packages/brain/src';
      const coverageData = {
        [`${sourceDir}/no-lines.js`]: {},
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(coverageData));

      const scanner = new CoverageScanner({ minCoverage: 70 });
      const issues = await scanner.scan();

      expect(issues).toHaveLength(1);
      expect(issues[0].current_value).toBe(0);
    });

    it('JSON 解析异常时返回空数组（不崩溃）', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('invalid-json{{{');

      const scanner = new CoverageScanner();
      const issues = await scanner.scan();

      expect(issues).toEqual([]);
    });

    it('覆盖率恰好等于 minCoverage 时不算低覆盖率', async () => {
      mockExistsSync.mockReturnValue(true);

      const sourceDir = './packages/brain/src';
      const coverageData = {
        [`${sourceDir}/exact.js`]: { lines: { pct: 70 } },
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(coverageData));

      const scanner = new CoverageScanner({ minCoverage: 70 });
      const issues = await scanner.scan();

      expect(issues).toHaveLength(0);
    });
  });

  // ============================================================
  // generateTask
  // ============================================================

  describe('generateTask', () => {
    it('正常路径：生成包含模块名、覆盖率信息的任务', async () => {
      const scanner = new CoverageScanner();
      const issue = {
        module_path: '/packages/brain/src/tick.js',
        issue_type: 'low_coverage',
        current_value: 30,
        target_value: 70,
        severity: 'medium',
      };

      const task = await scanner.generateTask(issue);

      expect(task.title).toContain('tick');
      expect(task.description).toContain('30%');
      expect(task.description).toContain('70%');
      expect(task.priority).toBe('P1');
    });

    it('severity=high 时 priority 为 P0', async () => {
      const scanner = new CoverageScanner();
      const issue = {
        module_path: '/packages/brain/src/executor.js',
        issue_type: 'low_coverage',
        current_value: 20,
        target_value: 70,
        severity: 'high',
      };

      const task = await scanner.generateTask(issue);

      expect(task.priority).toBe('P0');
    });

    it('severity=medium 时 priority 为 P1', async () => {
      const scanner = new CoverageScanner();
      const issue = {
        module_path: '/packages/brain/src/foo.js',
        issue_type: 'low_coverage',
        current_value: 60,
        target_value: 70,
        severity: 'medium',
      };

      const task = await scanner.generateTask(issue);

      expect(task.priority).toBe('P1');
    });

    it('tags 包含 quality、coverage、test', async () => {
      const scanner = new CoverageScanner();
      const issue = {
        module_path: '/packages/brain/src/foo.js',
        issue_type: 'low_coverage',
        current_value: 50,
        target_value: 70,
        severity: 'medium',
      };

      const task = await scanner.generateTask(issue);

      expect(task.tags).toContain('quality');
      expect(task.tags).toContain('coverage');
      expect(task.tags).toContain('test');
    });

    it('metadata 包含正确字段', async () => {
      const scanner = new CoverageScanner();
      const issue = {
        module_path: '/packages/brain/src/bar.js',
        issue_type: 'low_coverage',
        current_value: 40,
        target_value: 70,
        severity: 'high',
      };

      const task = await scanner.generateTask(issue);

      expect(task.metadata.scanner).toBe('coverage');
      expect(task.metadata.module_path).toBe(issue.module_path);
      expect(task.metadata.current_value).toBe(40);
      expect(task.metadata.target_value).toBe(70);
      expect(task.metadata.issue_type).toBe('low_coverage');
    });

    it('current_value 被四舍五入为整数显示在描述中', async () => {
      const scanner = new CoverageScanner();
      const issue = {
        module_path: '/packages/brain/src/test.js',
        issue_type: 'low_coverage',
        current_value: 45.7,
        target_value: 70,
        severity: 'medium',
      };

      const task = await scanner.generateTask(issue);

      expect(task.description).toContain('46%');
    });
  });
});
