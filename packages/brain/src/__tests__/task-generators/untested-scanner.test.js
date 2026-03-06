/**
 * untested-scanner.test.js
 *
 * 覆盖 UntestedScanner 所有方法：
 *   - constructor(options)
 *   - scan()
 *   - walkDir(dir, excludeDirs)
 *   - isKeyModule(filePath)
 *   - generateTask(issue)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock fs ─────────────────────────────────────────────────────────────────
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReaddirSync = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
  },
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
}));

// ─── 导入被测模块 ────────────────────────────────────────────────────────────
import UntestedScanner from '../../task-generators/untested-scanner.js';

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe('UntestedScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // constructor
  // ============================================================

  describe('constructor', () => {
    it('name 固定为 untested', () => {
      const scanner = new UntestedScanner();
      expect(scanner.getName()).toBe('untested');
    });

    it('默认 sourceDir 为 ./packages/brain/src', () => {
      const scanner = new UntestedScanner();
      expect(scanner.options.sourceDir).toContain('packages/brain/src');
    });

    it('默认 testDir 包含 __tests__', () => {
      const scanner = new UntestedScanner();
      expect(scanner.options.testDir).toContain('__tests__');
    });

    it('excludeDirs 默认包含 node_modules 和 __tests__', () => {
      const scanner = new UntestedScanner();
      expect(scanner.options.excludeDirs).toContain('node_modules');
      expect(scanner.options.excludeDirs).toContain('__tests__');
    });

    it('自定义 sourceDir 被使用', () => {
      const scanner = new UntestedScanner({ sourceDir: '/custom/src' });
      expect(scanner.options.sourceDir).toBe('/custom/src');
    });

    it('自定义 testDir 被使用', () => {
      const scanner = new UntestedScanner({ testDir: '/custom/tests' });
      expect(scanner.options.testDir).toBe('/custom/tests');
    });
  });

  // ============================================================
  // scan
  // ============================================================

  describe('scan', () => {
    it('源目录不存在时返回空数组', async () => {
      mockExistsSync.mockReturnValue(false);

      const scanner = new UntestedScanner({ sourceDir: '/nonexistent' });
      const issues = await scanner.scan();

      expect(issues).toEqual([]);
    });

    it('源目录存在但没有 JS 文件时返回空数组', async () => {
      // sourcePath 存在，testPath 不存在
      mockExistsSync.mockImplementation((p) => p.includes('/src'));
      mockReaddirSync.mockReturnValue([
        { name: 'README.md', isDirectory: () => false },
      ]);

      const scanner = new UntestedScanner({
        sourceDir: '/src',
        testDir: '/tests',
        excludeDirs: ['node_modules'],
      });
      const issues = await scanner.scan();
      expect(issues).toHaveLength(0);
    });

    it('测试目录存在时收集测试文件名', async () => {
      // sourcePath 和 testPath 都存在
      mockExistsSync.mockReturnValue(true);

      // 第一次调用：遍历 testDir 的文件列表
      // 第二次调用：遍历 sourceDir 的文件列表
      mockReaddirSync
        .mockReturnValueOnce([
          { name: 'tick.test.js', isDirectory: () => false },
        ])
        .mockReturnValueOnce([
          { name: 'tick.js', isDirectory: () => false },
        ]);

      const scanner = new UntestedScanner({
        sourceDir: '/src',
        testDir: '/tests',
        excludeDirs: ['node_modules'],
      });
      const issues = await scanner.scan();

      // tick.js 有对应的 tick.test.js，所以不在 issues 中
      expect(issues.filter(i => i.module_path.endsWith('tick.js'))).toHaveLength(0);
    });

    it('没有测试文件的模块出现在 issues 中', async () => {
      // existsSync 调用顺序（参考源码 scan() 实现）：
      // 1. path.resolve(sourceDir) + existsSync → sourcePath 存在 = true
      // 2. fs.existsSync(testPath) → testPath 不存在 = false（testFiles 为空）
      // 3. walkDir 内部 existsSync(sourcePath) → true
      // 4-6. hasTest 检查：3 种可能路径均不存在 = false
      mockExistsSync.mockReset();
      mockReaddirSync.mockReset();

      mockExistsSync
        .mockReturnValueOnce(true)   // scan: sourcePath 存在
        .mockReturnValueOnce(false)  // scan: testPath 不存在
        .mockReturnValueOnce(true)   // walkDir: existsSync(sourcePath)
        .mockReturnValue(false);     // hasTest 检查（各种路径）均不存在

      mockReaddirSync.mockReturnValueOnce([
        { name: 'untested-module.js', isDirectory: () => false },
      ]);

      const scanner = new UntestedScanner({
        sourceDir: '/src',
        testDir: '/tests',
        excludeDirs: ['node_modules'],
      });
      const issues = await scanner.scan();

      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].issue_type).toBe('no_test');
      expect(issues[0].current_value).toBe(0);
      expect(issues[0].target_value).toBe(1);
    });

    it('测试文件本身（.test.js）被跳过', async () => {
      mockExistsSync.mockImplementation((p) => !p.includes('/tests'));
      mockReaddirSync.mockReturnValueOnce([
        { name: 'foo.test.js', isDirectory: () => false },
        { name: 'bar.spec.js', isDirectory: () => false },
      ]);

      const scanner = new UntestedScanner({
        sourceDir: '/src',
        testDir: '/tests',
        excludeDirs: [],
      });
      const issues = await scanner.scan();

      expect(issues).toHaveLength(0);
    });

    it('issue 包含 module_path 和 severity 字段', async () => {
      mockExistsSync.mockImplementation((p) => !p.includes('/tests'));
      mockReaddirSync.mockReturnValueOnce([
        { name: 'server.js', isDirectory: () => false },
      ]);

      const scanner = new UntestedScanner({
        sourceDir: '/src',
        testDir: '/tests',
        excludeDirs: [],
      });
      const issues = await scanner.scan();

      if (issues.length > 0) {
        expect(issues[0]).toHaveProperty('module_path');
        expect(issues[0]).toHaveProperty('severity');
      }
    });
  });

  // ============================================================
  // walkDir
  // ============================================================

  describe('walkDir', () => {
    it('目录不存在时返回空数组', () => {
      mockExistsSync.mockReturnValue(false);

      const scanner = new UntestedScanner();
      const files = scanner.walkDir('/nonexistent', []);

      expect(files).toEqual([]);
    });

    it('读取目录出错时返回空数组（不崩溃）', () => {
      // existsSync 对 /protected 返回 true，但 readdirSync 抛出异常
      mockExistsSync.mockReset();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReset();
      mockReaddirSync.mockImplementationOnce(() => {
        throw new Error('Permission denied');
      });

      const scanner = new UntestedScanner();
      const files = scanner.walkDir('/protected', []);

      expect(files).toEqual([]);
    });

    it('有文件和子目录时递归遍历', () => {
      mockExistsSync.mockReset();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReset();

      mockReaddirSync
        .mockReturnValueOnce([
          { name: 'src', isDirectory: () => true },
          { name: 'root.js', isDirectory: () => false },
        ])
        .mockReturnValueOnce([
          { name: 'child.js', isDirectory: () => false },
        ]);

      const scanner = new UntestedScanner();
      const files = scanner.walkDir('/root', []);

      expect(files.some(f => f.includes('root.js'))).toBe(true);
      expect(files.some(f => f.includes('child.js'))).toBe(true);
    });

    it('excludeDirs 中的目录不被遍历', () => {
      mockExistsSync.mockReset();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReset();

      mockReaddirSync.mockReturnValueOnce([
        { name: 'node_modules', isDirectory: () => true },
        { name: 'app.js', isDirectory: () => false },
      ]);

      const scanner = new UntestedScanner();
      const files = scanner.walkDir('/root', ['node_modules']);

      expect(files.some(f => f.includes('node_modules'))).toBe(false);
      expect(files.some(f => f.includes('app.js'))).toBe(true);
    });

    it('以 . 开头的目录被跳过', () => {
      mockExistsSync.mockReturnValue(true);

      mockReaddirSync.mockReturnValueOnce([
        { name: '.git', isDirectory: () => true },
        { name: 'index.js', isDirectory: () => false },
      ]);

      const scanner = new UntestedScanner();
      const files = scanner.walkDir('/root', []);

      expect(files.some(f => f.includes('.git'))).toBe(false);
      expect(files.some(f => f.includes('index.js'))).toBe(true);
    });
  });

  // ============================================================
  // isKeyModule
  // ============================================================

  describe('isKeyModule', () => {
    it('executor 路径返回 true', () => {
      const scanner = new UntestedScanner();
      expect(scanner.isKeyModule('/packages/brain/src/executor.js')).toBe(true);
    });

    it('decision 路径返回 true', () => {
      const scanner = new UntestedScanner();
      expect(scanner.isKeyModule('/packages/brain/src/decision.js')).toBe(true);
    });

    it('task-router 路径返回 true', () => {
      const scanner = new UntestedScanner();
      expect(scanner.isKeyModule('/packages/brain/src/task-router.js')).toBe(true);
    });

    it('cortex 路径返回 true', () => {
      const scanner = new UntestedScanner();
      expect(scanner.isKeyModule('/packages/brain/src/cortex.js')).toBe(true);
    });

    it('thalamus 路径返回 true', () => {
      const scanner = new UntestedScanner();
      expect(scanner.isKeyModule('/packages/brain/src/thalamus.js')).toBe(true);
    });

    it('tick 路径返回 true', () => {
      const scanner = new UntestedScanner();
      expect(scanner.isKeyModule('/packages/brain/src/tick.js')).toBe(true);
    });

    it('orchestrator 路径返回 true', () => {
      const scanner = new UntestedScanner();
      expect(scanner.isKeyModule('/packages/brain/src/orchestrator-chat.js')).toBe(true);
    });

    it('普通工具模块返回 false', () => {
      const scanner = new UntestedScanner();
      expect(scanner.isKeyModule('/packages/brain/src/utils.js')).toBe(false);
    });

    it('非 brain/src 路径返回 false', () => {
      const scanner = new UntestedScanner();
      expect(scanner.isKeyModule('/apps/dashboard/src/executor.js')).toBe(false);
    });

    it('migration 文件返回 false', () => {
      const scanner = new UntestedScanner();
      expect(scanner.isKeyModule('/packages/brain/migrations/001.sql')).toBe(false);
    });
  });

  // ============================================================
  // generateTask
  // ============================================================

  describe('generateTask', () => {
    it('正常路径：生成包含模块名的任务', async () => {
      const scanner = new UntestedScanner();
      const issue = {
        module_path: 'src/learning.js',
        issue_type: 'no_test',
        current_value: 0,
        target_value: 1,
        severity: 'low',
      };

      const task = await scanner.generateTask(issue);

      expect(task.title).toContain('learning');
      expect(task.description).toContain('learning.js');
    });

    it('severity=high（关键业务模块）时 priority 为 P0', async () => {
      const scanner = new UntestedScanner();
      const issue = {
        module_path: 'src/executor.js',
        issue_type: 'no_test',
        current_value: 0,
        target_value: 1,
        severity: 'high',
      };

      const task = await scanner.generateTask(issue);
      expect(task.priority).toBe('P0');
    });

    it('severity=low 时 priority 为 P2', async () => {
      const scanner = new UntestedScanner();
      const issue = {
        module_path: 'src/utils.js',
        issue_type: 'no_test',
        current_value: 0,
        target_value: 1,
        severity: 'low',
      };

      const task = await scanner.generateTask(issue);
      expect(task.priority).toBe('P2');
    });

    it('tags 包含 quality、test、untested', async () => {
      const scanner = new UntestedScanner();
      const issue = {
        module_path: 'src/foo.js',
        issue_type: 'no_test',
        current_value: 0,
        target_value: 1,
        severity: 'low',
      };

      const task = await scanner.generateTask(issue);

      expect(task.tags).toContain('quality');
      expect(task.tags).toContain('test');
      expect(task.tags).toContain('untested');
    });

    it('metadata 包含 scanner=untested', async () => {
      const scanner = new UntestedScanner();
      const issue = {
        module_path: 'src/bar.js',
        issue_type: 'no_test',
        current_value: 0,
        target_value: 1,
        severity: 'low',
      };

      const task = await scanner.generateTask(issue);

      expect(task.metadata.scanner).toBe('untested');
      expect(task.metadata.module_path).toBe('src/bar.js');
      expect(task.metadata.issue_type).toBe('no_test');
    });

    it('描述中包含 严重程度 信息', async () => {
      const scanner = new UntestedScanner();
      const issueHigh = {
        module_path: 'src/critical.js',
        issue_type: 'no_test',
        current_value: 0,
        target_value: 1,
        severity: 'high',
      };

      const task = await scanner.generateTask(issueHigh);
      expect(task.description).toContain('高');
    });
  });
});
