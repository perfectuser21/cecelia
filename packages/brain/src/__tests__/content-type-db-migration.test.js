/**
 * content-type DB 迁移测试
 * 验证 DB 优先 + YAML 兜底逻辑
 *
 * 注意：这些测试 mock 了 DB 层，不需要实际 PostgreSQL 连接
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool — 必须在 import 被测模块前声明
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

// 动态 import 以确保 mock 生效
let getContentType, listContentTypes, getContentTypeFromYaml, listContentTypesFromYaml;
let pool;

beforeEach(async () => {
  vi.resetModules();

  // 重新 mock
  vi.mock('../db.js', () => ({
    default: {
      query: vi.fn(),
    },
  }));

  const registry = await import('../content-types/content-type-registry.js');
  getContentType = registry.getContentType;
  listContentTypes = registry.listContentTypes;
  getContentTypeFromYaml = registry.getContentTypeFromYaml;
  listContentTypesFromYaml = registry.listContentTypesFromYaml;

  const dbModule = await import('../db.js');
  pool = dbModule.default;
});

describe('content-type-registry DB 优先逻辑', () => {
  describe('getContentType — DB 优先', () => {
    it('DB 有记录时返回 DB 配置', async () => {
      const dbConfig = {
        content_type: 'test-type',
        images: { count: 3, format: 'png' },
        template: { research_prompt: 'test', generate_prompt: 'test' },
        review_rules: ['rule1'],
        copy_rules: ['rule1'],
      };

      pool.query.mockResolvedValueOnce({
        rows: [{ config: dbConfig }],
      });

      const result = await getContentType('test-type');
      expect(result).toEqual(dbConfig);
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT config FROM content_type_configs WHERE content_type = $1',
        ['test-type']
      );
    });

    it('DB 无记录时 fallback 到 YAML', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await getContentType('solo-company-case');
      expect(result).not.toBeNull();
      expect(result.content_type).toBe('solo-company-case');
    });

    it('DB 查询失败时静默降级到 YAML', async () => {
      pool.query.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await getContentType('solo-company-case');
      expect(result).not.toBeNull();
      expect(result.content_type).toBe('solo-company-case');
    });

    it('DB 和 YAML 都无记录时返回 null', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await getContentType('nonexistent-type-xyz');
      expect(result).toBeNull();
    });
  });

  describe('listContentTypes — 合并 DB + YAML', () => {
    it('合并 DB 和 YAML 类型列表并去重', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { content_type: 'db-only-type' },
          { content_type: 'solo-company-case' }, // 与 YAML 重复
        ],
      });

      const types = await listContentTypes();
      expect(Array.isArray(types)).toBe(true);
      expect(types).toContain('db-only-type');
      expect(types).toContain('solo-company-case');
      // 去重：solo-company-case 只出现一次
      const count = types.filter((t) => t === 'solo-company-case').length;
      expect(count).toBe(1);
    });

    it('DB 查询失败时仅返回 YAML 类型', async () => {
      pool.query.mockRejectedValueOnce(new Error('Connection refused'));

      const types = await listContentTypes();
      expect(Array.isArray(types)).toBe(true);
      expect(types).toContain('solo-company-case');
    });
  });

  describe('getContentTypeFromYaml — YAML 直接读取', () => {
    it('应返回 solo-company-case 的 YAML 配置', () => {
      const config = getContentTypeFromYaml('solo-company-case');
      expect(config).not.toBeNull();
      expect(config.content_type).toBe('solo-company-case');
    });

    it('不存在的类型应返回 null', () => {
      const config = getContentTypeFromYaml('nonexistent-type');
      expect(config).toBeNull();
    });
  });

  describe('listContentTypesFromYaml — YAML 目录列表', () => {
    it('应返回包含 solo-company-case 的数组', () => {
      const types = listContentTypesFromYaml();
      expect(Array.isArray(types)).toBe(true);
      expect(types).toContain('solo-company-case');
    });
  });
});
