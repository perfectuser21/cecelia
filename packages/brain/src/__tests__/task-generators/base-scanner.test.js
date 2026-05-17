/**
 * base-scanner.test.js
 *
 * 覆盖 BaseScanner 所有方法：
 *   - constructor(name, options)
 *   - scan()
 *   - getName()
 *   - getThreshold()
 *   - generateTask(issue)
 *   - saveScanResult(issue, taskId)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock db.js（saveScanResult 通过动态 import 使用）────────────────────────
const mockQuery = vi.hoisted(() => vi.fn());

vi.mock('../../db.js', () => ({
  default: { query: mockQuery },
}));

// ─── 导入被测模块 ────────────────────────────────────────────────────────────
import BaseScanner from '../../task-generators/base-scanner.js';

// ─── 具体子类（用于测试非抽象方法）──────────────────────────────────────────
class ConcreteScanner extends BaseScanner {
  async scan() {
    return [];
  }

  async generateTask(issue) {
    return { title: `Fix ${issue.module_path}` };
  }
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe('BaseScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // constructor
  // ============================================================

  describe('constructor', () => {
    it('正常路径：name 和 options 被正确赋值', () => {
      const scanner = new ConcreteScanner('my-scanner', { threshold: { min: 50 } });
      expect(scanner.name).toBe('my-scanner');
      expect(scanner.options).toEqual({ threshold: { min: 50 } });
    });

    it('options 默认为空对象', () => {
      const scanner = new ConcreteScanner('test');
      expect(scanner.options).toEqual({});
    });

    it('name 被正确存储', () => {
      const scanner = new ConcreteScanner('coverage');
      expect(scanner.name).toBe('coverage');
    });
  });

  // ============================================================
  // getName
  // ============================================================

  describe('getName', () => {
    it('返回构造时传入的 name', () => {
      const scanner = new ConcreteScanner('complexity');
      expect(scanner.getName()).toBe('complexity');
    });

    it('name 为空字符串时也能正常返回', () => {
      const scanner = new ConcreteScanner('');
      expect(scanner.getName()).toBe('');
    });

    it('特殊字符 name 也能正常返回', () => {
      const scanner = new ConcreteScanner('my-scanner-v2');
      expect(scanner.getName()).toBe('my-scanner-v2');
    });
  });

  // ============================================================
  // getThreshold
  // ============================================================

  describe('getThreshold', () => {
    it('有 threshold 配置时返回正确值', () => {
      const scanner = new ConcreteScanner('test', { threshold: { min: 70, max: 100 } });
      expect(scanner.getThreshold()).toEqual({ min: 70, max: 100 });
    });

    it('没有 threshold 配置时返回空对象', () => {
      const scanner = new ConcreteScanner('test', {});
      expect(scanner.getThreshold()).toEqual({});
    });

    it('options 为默认值时返回空对象', () => {
      const scanner = new ConcreteScanner('test');
      expect(scanner.getThreshold()).toEqual({});
    });

    it('options 有其他字段但没有 threshold 时返回空对象', () => {
      const scanner = new ConcreteScanner('test', { coverageDir: './coverage' });
      expect(scanner.getThreshold()).toEqual({});
    });
  });

  // ============================================================
  // scan（抽象方法 - 基类抛出错误）
  // ============================================================

  describe('scan（基类抽象方法）', () => {
    it('直接调用基类 scan() 抛出 Error', async () => {
      const scanner = new BaseScanner('base');
      await expect(scanner.scan()).rejects.toThrow('scan() must be implemented by subclass');
    });

    it('子类实现的 scan() 正常调用不报错', async () => {
      const scanner = new ConcreteScanner('test');
      const result = await scanner.scan();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ============================================================
  // generateTask（抽象方法 - 基类抛出错误）
  // ============================================================

  describe('generateTask（基类抽象方法）', () => {
    it('直接调用基类 generateTask() 抛出 Error', async () => {
      const scanner = new BaseScanner('base');
      await expect(scanner.generateTask({})).rejects.toThrow('generateTask() must be implemented by subclass');
    });

    it('子类实现的 generateTask() 正常返回任务', async () => {
      const scanner = new ConcreteScanner('test');
      const issue = { module_path: 'src/foo.js' };
      const task = await scanner.generateTask(issue);
      expect(task).toEqual({ title: 'Fix src/foo.js' });
    });

    it('子类 generateTask 可以接收任意 issue 对象', async () => {
      const scanner = new ConcreteScanner('test');
      const issue = {
        module_path: 'src/bar.js',
        issue_type: 'low_coverage',
        current_value: 30,
        target_value: 70,
      };
      const task = await scanner.generateTask(issue);
      expect(task.title).toBe('Fix src/bar.js');
    });
  });

  // ============================================================
  // saveScanResult
  // ============================================================

  describe('saveScanResult', () => {
    it('正常路径：调用 pool.query 并传入正确参数', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const scanner = new ConcreteScanner('coverage');
      const issue = {
        module_path: 'src/tick.js',
        issue_type: 'low_coverage',
        current_value: 30,
        target_value: 70,
      };

      await scanner.saveScanResult(issue, 'task-id-123');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO scan_results');
      expect(params[0]).toBe('coverage');      // scanner_name
      expect(params[1]).toBe('src/tick.js');   // module_path
      expect(params[2]).toBe('low_coverage');  // issue_type
      expect(params[3]).toBe(30);              // current_value
      expect(params[4]).toBe(70);              // target_value
      expect(params[5]).toBe('task-id-123');   // task_id
    });

    it('scanner_name 使用 this.name', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const scanner = new ConcreteScanner('complexity');
      const issue = {
        module_path: 'src/executor.js',
        issue_type: 'high_complexity',
        current_value: 15,
        target_value: 10,
      };

      await scanner.saveScanResult(issue, 'task-456');

      const [, params] = mockQuery.mock.calls[0];
      expect(params[0]).toBe('complexity');
    });

    it('taskId 为 null 时也能正常调用', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const scanner = new ConcreteScanner('untested');
      const issue = {
        module_path: 'src/foo.js',
        issue_type: 'no_test',
        current_value: 0,
        target_value: 1,
      };

      await scanner.saveScanResult(issue, null);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [, params] = mockQuery.mock.calls[0];
      expect(params[5]).toBeNull();
    });

    it('db.query 抛出异常时 saveScanResult 也抛出', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));

      const scanner = new ConcreteScanner('coverage');
      const issue = {
        module_path: 'src/foo.js',
        issue_type: 'low_coverage',
        current_value: 20,
        target_value: 70,
      };

      await expect(scanner.saveScanResult(issue, 'task-789')).rejects.toThrow('DB error');
    });

    it('SQL 包含正确的字段列表', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const scanner = new ConcreteScanner('test');
      const issue = {
        module_path: 'src/test.js',
        issue_type: 'test_issue',
        current_value: 5,
        target_value: 10,
      };

      await scanner.saveScanResult(issue, 'task-001');

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('scanner_name');
      expect(sql).toContain('module_path');
      expect(sql).toContain('issue_type');
      expect(sql).toContain('current_value');
      expect(sql).toContain('target_value');
      expect(sql).toContain('task_id');
    });
  });
});
