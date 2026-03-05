import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Mock fs 模块（避免真实文件系统依赖）
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    default: {
      ...actual,
      existsSync: vi.fn(),
      readdirSync: vi.fn(),
      readFileSync: vi.fn(),
    },
  };
});

import {
  scanForMissingTests,
  scanForComplexity,
  runFullScan,
  estimateComplexity,
  extractBracedBlock,
  findHighComplexityFunctions,
} from '../code-scanner.js';

describe('code-scanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===== estimateComplexity =====
  describe('estimateComplexity()', () => {
    it('简单函数返回复杂度 1', () => {
      const body = `
        const x = 1;
        return x;
      `;
      expect(estimateComplexity(body)).toBe(1);
    });

    it('if 语句增加复杂度', () => {
      const body = `
        if (a > 0) {
          return a;
        }
        return 0;
      `;
      // 1 (base) + 1 (if)
      expect(estimateComplexity(body)).toBeGreaterThan(1);
    });

    it('多个分支点正确累加', () => {
      const body = `
        if (a > 0) {
          return a;
        } else if (b > 0) {
          return b;
        }
        for (let i = 0; i < 10; i++) {
          if (i > 5) break;
        }
        return a && b ? a : b;
      `;
      const complexity = estimateComplexity(body);
      expect(complexity).toBeGreaterThan(5);
    });
  });

  // ===== extractBracedBlock =====
  describe('extractBracedBlock()', () => {
    it('提取简单括号块', () => {
      const content = '{ return 1; }';
      const result = extractBracedBlock(content, 0);
      expect(result).toBe(' return 1; ');
    });

    it('提取嵌套括号块', () => {
      const content = '{ if (x) { return 1; } return 2; }';
      const result = extractBracedBlock(content, 0);
      expect(result).toBe(' if (x) { return 1; } return 2; ');
    });

    it('非 { 起始返回 null', () => {
      const content = 'const x = 1;';
      expect(extractBracedBlock(content, 0)).toBeNull();
    });
  });

  // ===== findHighComplexityFunctions =====
  describe('findHighComplexityFunctions()', () => {
    it('低复杂度函数不返回', () => {
      const content = `
        function simple(a, b) {
          return a + b;
        }
      `;
      const results = findHighComplexityFunctions(content);
      expect(results).toHaveLength(0);
    });

    it('高复杂度函数被检测到', () => {
      // 构造复杂度 > 10 的函数
      const body = Array(12).fill('if (a) { x++; }').join('\n');
      const content = `
        function complexFunc(a, x) {
          ${body}
          return x;
        }
      `;
      const results = findHighComplexityFunctions(content);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('complexFunc');
      expect(results[0].complexity).toBeGreaterThan(10);
    });
  });

  // ===== scanForMissingTests =====
  describe('scanForMissingTests()', () => {
    it('返回缺少测试的模块', () => {
      // Mock: src/ 有 foo.js, bar.js；__tests__/ 只有 foo.test.js
      fs.existsSync.mockImplementation((dir) => {
        return dir.includes('__tests__') || dir.includes('/src');
      });
      fs.readdirSync.mockImplementation((dir, opts) => {
        if (dir.includes('__tests__')) {
          return opts?.withFileTypes
            ? [{ name: 'foo.test.js', isFile: () => true }]
            : ['foo.test.js'];
        }
        // src/ 目录
        return opts?.withFileTypes
          ? [
              { name: 'foo.js', isFile: () => true },
              { name: 'bar.js', isFile: () => true },
              { name: 'db.js', isFile: () => true },  // 排除文件
              { name: '__tests__', isFile: () => false },
            ]
          : ['foo.js', 'bar.js', 'db.js'];
      });

      const results = scanForMissingTests();

      // bar.js 缺少测试，foo.js 有测试，db.js 被排除
      expect(results).toHaveLength(1);
      expect(results[0].scanType).toBe('missing_tests');
      expect(results[0].filePath).toContain('bar.js');
      expect(results[0].suggestedTaskTitle).toContain('bar');
    });

    it('所有模块都有测试时返回空数组', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockImplementation((dir, opts) => {
        if (dir.includes('__tests__')) {
          return opts?.withFileTypes
            ? [{ name: 'foo.test.js', isFile: () => true }]
            : ['foo.test.js'];
        }
        return opts?.withFileTypes
          ? [{ name: 'foo.js', isFile: () => true }]
          : ['foo.js'];
      });

      const results = scanForMissingTests();
      expect(results).toHaveLength(0);
    });
  });

  // ===== scanForComplexity =====
  describe('scanForComplexity()', () => {
    it('返回高复杂度函数结果', () => {
      const complexBody = Array(12).fill('if (a) { x++; }').join('\n');
      const mockContent = `
        function complexHandler(a, x) {
          ${complexBody}
          return x;
        }
      `;

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockImplementation((dir, opts) => {
        if (dir.includes('routes')) {
          return opts?.withFileTypes ? [] : [];
        }
        return opts?.withFileTypes
          ? [{ name: 'tick.js', isFile: () => true }]
          : ['tick.js'];
      });
      fs.readFileSync.mockReturnValue(mockContent);

      const results = scanForComplexity();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].scanType).toBe('high_complexity');
      expect(results[0].suggestedTaskTitle).toContain('complexHandler');
    });

    it('routes 目录无文件时不报错', () => {
      fs.existsSync.mockImplementation((dir) => !dir.includes('routes'));
      fs.readdirSync.mockReturnValue([]);

      expect(() => scanForComplexity()).not.toThrow();
    });
  });

  // ===== runFullScan =====
  describe('runFullScan()', () => {
    it('返回合并后的扫描结果', () => {
      // Mock: 有缺失测试的模块 + 有复杂函数
      const complexBody = Array(12).fill('if (a) { x++; }').join('\n');
      const mockContent = `
        function handler(a, x) {
          ${complexBody}
          return x;
        }
      `;

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockImplementation((dir, opts) => {
        if (dir.includes('__tests__')) {
          return opts?.withFileTypes ? [] : [];
        }
        if (dir.includes('routes')) {
          return opts?.withFileTypes ? [] : [];
        }
        return opts?.withFileTypes
          ? [{ name: 'tick.js', isFile: () => true }]
          : ['tick.js'];
      });
      fs.readFileSync.mockReturnValue(mockContent);

      const results = runFullScan();
      expect(Array.isArray(results)).toBe(true);
      // 应有 missing_tests（tick.js 无测试）和 high_complexity 结果
      const types = new Set(results.map(r => r.scanType));
      expect(types.has('missing_tests')).toBe(true);
    });

    it('结果中每条都有必要字段', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockImplementation((dir, opts) => {
        if (dir.includes('__tests__') || dir.includes('routes')) {
          return opts?.withFileTypes ? [] : [];
        }
        return opts?.withFileTypes
          ? [{ name: 'foo.js', isFile: () => true }]
          : ['foo.js'];
      });
      fs.readFileSync.mockReturnValue('const x = 1;');

      const results = runFullScan();
      for (const r of results) {
        expect(r).toHaveProperty('scanType');
        expect(r).toHaveProperty('filePath');
        expect(r).toHaveProperty('issueDescription');
        expect(r).toHaveProperty('suggestedTaskTitle');
      }
    });
  });
});
