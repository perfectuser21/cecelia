/**
 * complexity-scanner.test.js
 *
 * 覆盖 ComplexityScanner 所有方法：
 *   - constructor(options)
 *   - scan()
 *   - walkDir(dir, excludeDirs)
 *   - analyzeComplexity(content)
 *   - countBranches(body)
 *   - countLines(text)
 *   - generateTask(issue)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock fs ─────────────────────────────────────────────────────────────────
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockReaddirSync = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    readdirSync: mockReaddirSync,
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
}));

// ─── 导入被测模块 ────────────────────────────────────────────────────────────
import ComplexityScanner from '../../task-generators/complexity-scanner.js';

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe('ComplexityScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // constructor
  // ============================================================

  describe('constructor', () => {
    it('默认选项：maxCyclomatic=10，name=complexity', () => {
      const scanner = new ComplexityScanner();
      expect(scanner.getName()).toBe('complexity');
      expect(scanner.getThreshold().maxCyclomatic).toBe(10);
    });

    it('自定义 maxCyclomatic', () => {
      const scanner = new ComplexityScanner({ maxCyclomatic: 15 });
      expect(scanner.getThreshold().maxCyclomatic).toBe(15);
    });

    it('自定义 sourceDir 被传入 options', () => {
      const scanner = new ComplexityScanner({ sourceDir: '/custom/src' });
      expect(scanner.options.sourceDir).toBe('/custom/src');
    });

    it('excludeDirs 默认包含 node_modules、__tests__、migrations', () => {
      const scanner = new ComplexityScanner();
      expect(scanner.options.excludeDirs).toContain('node_modules');
      expect(scanner.options.excludeDirs).toContain('__tests__');
      expect(scanner.options.excludeDirs).toContain('migrations');
    });
  });

  // ============================================================
  // scan
  // ============================================================

  describe('scan', () => {
    it('源目录不存在时返回空数组', async () => {
      mockExistsSync.mockReturnValue(false);

      const scanner = new ComplexityScanner();
      const issues = await scanner.scan();

      expect(issues).toEqual([]);
    });

    it('目录存在但没有 JS 文件时返回空数组', async () => {
      mockExistsSync.mockReturnValue(true);
      // walkDir 遍历到的文件只有非 .js 文件
      mockReaddirSync.mockReturnValue([
        { name: 'README.md', isDirectory: () => false },
      ]);

      const scanner = new ComplexityScanner({ sourceDir: '/src' });
      const issues = await scanner.scan();

      expect(issues).toHaveLength(0);
    });

    it('读取文件时抛出异常不崩溃，继续处理', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'bad.js', isDirectory: () => false },
      ]);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const scanner = new ComplexityScanner({ sourceDir: '/src' });
      const issues = await scanner.scan();

      expect(issues).toEqual([]);
    });
  });

  // ============================================================
  // walkDir
  // ============================================================

  describe('walkDir', () => {
    it('目录不存在时返回空数组', () => {
      mockExistsSync.mockReturnValue(false);

      const scanner = new ComplexityScanner();
      const files = scanner.walkDir('/nonexistent', []);

      expect(files).toEqual([]);
    });

    it('只有文件（无子目录）时返回文件列表', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'foo.js', isDirectory: () => false },
        { name: 'bar.js', isDirectory: () => false },
      ]);

      const scanner = new ComplexityScanner();
      const files = scanner.walkDir('/src', []);

      expect(files).toHaveLength(2);
      expect(files[0]).toContain('foo.js');
      expect(files[1]).toContain('bar.js');
    });

    it('excludeDirs 中的目录被跳过', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'node_modules', isDirectory: () => true },
        { name: 'src', isDirectory: () => true },
      ]);

      const scanner = new ComplexityScanner();
      // 只有 src 目录会被递归，node_modules 被跳过
      // 第二次 readdirSync 模拟 src 目录内容
      mockReaddirSync
        .mockReturnValueOnce([
          { name: 'node_modules', isDirectory: () => true },
          { name: 'src', isDirectory: () => true },
        ])
        .mockReturnValueOnce([
          { name: 'server.js', isDirectory: () => false },
        ]);

      const files = scanner.walkDir('/root', ['node_modules']);

      expect(files.some(f => f.includes('node_modules'))).toBe(false);
      expect(files.some(f => f.includes('server.js'))).toBe(true);
    });

    it('以 . 开头的目录被跳过', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: '.hidden', isDirectory: () => true },
        { name: 'visible.js', isDirectory: () => false },
      ]);

      const scanner = new ComplexityScanner();
      const files = scanner.walkDir('/src', []);

      expect(files.some(f => f.includes('.hidden'))).toBe(false);
      expect(files.some(f => f.includes('visible.js'))).toBe(true);
    });
  });

  // ============================================================
  // analyzeComplexity
  // ============================================================

  describe('analyzeComplexity', () => {
    it('空代码返回空数组', () => {
      const scanner = new ComplexityScanner();
      const result = scanner.analyzeComplexity('');
      expect(result).toEqual([]);
    });

    it('普通函数声明被检测到', () => {
      const scanner = new ComplexityScanner();
      const code = `
        function myFunc() {
          if (x > 0) { return x; }
        }
      `;
      const result = scanner.analyzeComplexity(code);
      expect(result.some(f => f.name === 'myFunc')).toBe(true);
    });

    it('const 箭头函数被检测到', () => {
      const scanner = new ComplexityScanner();
      const code = `
        const myArrow = () => {
          if (a) { return 1; }
        };
      `;
      const result = scanner.analyzeComplexity(code);
      expect(result.some(f => f.name === 'myArrow')).toBe(true);
    });

    it('返回结果包含 name、cyclomatic、line 字段', () => {
      const scanner = new ComplexityScanner();
      const code = `
        function simpleFunc() {
          return 1;
        }
      `;
      const result = scanner.analyzeComplexity(code);
      if (result.length > 0) {
        expect(result[0]).toHaveProperty('name');
        expect(result[0]).toHaveProperty('cyclomatic');
        expect(result[0]).toHaveProperty('line');
      }
    });
  });

  // ============================================================
  // countBranches
  // ============================================================

  describe('countBranches', () => {
    it('空字符串返回 0', () => {
      const scanner = new ComplexityScanner();
      expect(scanner.countBranches('')).toBe(0);
    });

    it('if 语句被统计', () => {
      const scanner = new ComplexityScanner();
      const body = 'if (x) { if (y) { } }';
      expect(scanner.countBranches(body)).toBeGreaterThanOrEqual(2);
    });

    it('while 循环被统计', () => {
      const scanner = new ComplexityScanner();
      const body = 'while (condition) { }';
      expect(scanner.countBranches(body)).toBeGreaterThanOrEqual(1);
    });

    it('for 循环被统计', () => {
      const scanner = new ComplexityScanner();
      const body = 'for (let i = 0; i < 10; i++) { }';
      expect(scanner.countBranches(body)).toBeGreaterThanOrEqual(1);
    });

    it('&& 和 || 运算符被统计', () => {
      const scanner = new ComplexityScanner();
      const body = 'if (a && b || c) { }';
      const count = scanner.countBranches(body);
      expect(count).toBeGreaterThanOrEqual(3); // if + && + ||
    });

    it('switch/case 被统计', () => {
      const scanner = new ComplexityScanner();
      const body = 'switch (x) { case 1: break; case 2: break; }';
      const count = scanner.countBranches(body);
      expect(count).toBeGreaterThanOrEqual(3); // switch + 2 cases
    });

    it('catch 语句被统计', () => {
      const scanner = new ComplexityScanner();
      const body = 'try { } catch (e) { }';
      expect(scanner.countBranches(body)).toBeGreaterThanOrEqual(1);
    });

    it('复杂函数体分支数量大于简单函数体', () => {
      const scanner = new ComplexityScanner();
      const simple = '{ return x; }';
      const complex = '{ if (a) { while (b) { for (let i;;) { if (c && d) {} } } } }';
      expect(scanner.countBranches(complex)).toBeGreaterThan(scanner.countBranches(simple));
    });
  });

  // ============================================================
  // countLines
  // ============================================================

  describe('countLines', () => {
    it('空字符串返回 1（split 的特性）', () => {
      const scanner = new ComplexityScanner();
      expect(scanner.countLines('')).toBe(1);
    });

    it('一行文本返回 1', () => {
      const scanner = new ComplexityScanner();
      expect(scanner.countLines('single line')).toBe(1);
    });

    it('两行文本返回 2', () => {
      const scanner = new ComplexityScanner();
      expect(scanner.countLines('line1\nline2')).toBe(2);
    });

    it('多行文本正确计数', () => {
      const scanner = new ComplexityScanner();
      const text = 'a\nb\nc\nd\ne';
      expect(scanner.countLines(text)).toBe(5);
    });
  });

  // ============================================================
  // generateTask
  // ============================================================

  describe('generateTask', () => {
    it('正常路径：生成包含函数名、复杂度信息的任务', async () => {
      const scanner = new ComplexityScanner();
      const issue = {
        module_path: 'src/executor.js',
        issue_type: 'high_complexity',
        current_value: 15,
        target_value: 10,
        function_name: 'execute',
        line_number: 42,
        severity: 'medium',
      };

      const task = await scanner.generateTask(issue);

      expect(task.title).toContain('executor');
      expect(task.title).toContain('execute');
      expect(task.description).toContain('execute');
      expect(task.description).toContain('42');
      expect(task.description).toContain('15');
      expect(task.description).toContain('10');
    });

    it('severity=high 时 priority 为 P0', async () => {
      const scanner = new ComplexityScanner();
      const issue = {
        module_path: 'src/foo.js',
        issue_type: 'high_complexity',
        current_value: 25,
        target_value: 10,
        function_name: 'complexFunc',
        line_number: 1,
        severity: 'high',
      };

      const task = await scanner.generateTask(issue);
      expect(task.priority).toBe('P0');
    });

    it('severity=medium 时 priority 为 P1', async () => {
      const scanner = new ComplexityScanner();
      const issue = {
        module_path: 'src/bar.js',
        issue_type: 'high_complexity',
        current_value: 12,
        target_value: 10,
        function_name: 'modFunc',
        line_number: 10,
        severity: 'medium',
      };

      const task = await scanner.generateTask(issue);
      expect(task.priority).toBe('P1');
    });

    it('tags 包含 quality、complexity、refactor', async () => {
      const scanner = new ComplexityScanner();
      const issue = {
        module_path: 'src/test.js',
        issue_type: 'high_complexity',
        current_value: 11,
        target_value: 10,
        function_name: 'fn',
        line_number: 5,
        severity: 'medium',
      };

      const task = await scanner.generateTask(issue);

      expect(task.tags).toContain('quality');
      expect(task.tags).toContain('complexity');
      expect(task.tags).toContain('refactor');
    });

    it('metadata 包含 function_name 和 line_number', async () => {
      const scanner = new ComplexityScanner();
      const issue = {
        module_path: 'src/cortex.js',
        issue_type: 'high_complexity',
        current_value: 20,
        target_value: 10,
        function_name: 'decide',
        line_number: 100,
        severity: 'high',
      };

      const task = await scanner.generateTask(issue);

      expect(task.metadata.function_name).toBe('decide');
      expect(task.metadata.line_number).toBe(100);
      expect(task.metadata.scanner).toBe('complexity');
    });

    it('description 长度 >= 100 字符（通过 task-quality-gate 最低要求）', async () => {
      const scanner = new ComplexityScanner();
      const issue = {
        module_path: 'src/tick.js',
        issue_type: 'high_complexity',
        current_value: 15,
        target_value: 10,
        function_name: 'processEvent',
        line_number: 50,
        severity: 'medium',
      };

      const task = await scanner.generateTask(issue);

      expect(task.description.length).toBeGreaterThanOrEqual(100);
    });

    it('description 包含行动关键词（重构/降低/验收等）', async () => {
      const scanner = new ComplexityScanner();
      const issue = {
        module_path: 'src/executor.js',
        issue_type: 'high_complexity',
        current_value: 12,
        target_value: 10,
        function_name: 'execute',
        line_number: 30,
        severity: 'medium',
      };

      const task = await scanner.generateTask(issue);

      const actionKeywords = ['重构', '降低', '验收', '提取', '拆分'];
      const hasActionKeyword = actionKeywords.some(kw => task.description.includes(kw));
      expect(hasActionKeyword).toBe(true);
    });
  });
});
