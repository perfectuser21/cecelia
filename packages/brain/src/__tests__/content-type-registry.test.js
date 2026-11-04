import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { query, dbConfig } = vi.hoisted(() => ({
  query: vi.fn(),
  dbConfig: {
    content_type: 'debt-12-db-only', images: { count: 2 },
    template: { generate_prompt: 'database template' },
    review_rules: ['database review'], copy_rules: ['database copy'],
    notebook_id: 'debt-12-notebook',
  },
}));
// 只替换外部 DB 边界，保留真实注册表与仓内 YAML 文件读取。
vi.mock('../db.js', () => ({ default: { query } }));
beforeEach(() => {
  query.mockReset();
  query.mockImplementation(async (sql, params) => {
    if (sql.startsWith('SELECT config') && params[0] === dbConfig.content_type) {
      return { rows: [{ config: structuredClone(dbConfig) }] };
    }
    return { rows: [] };
  });
});
afterEach(() => vi.restoreAllMocks());
import { getContentType, listContentTypes, loadAllContentTypes } from '../content-types/content-type-registry.js';

describe('content-type-registry', () => {
  describe('getContentType', () => {
    it('应返回 solo-company-case 的完整配置', async () => {
      const config = await getContentType('solo-company-case');
      expect(config).not.toBeNull();
      expect(config.content_type).toBe('solo-company-case');
      expect(config.images).toBeDefined();
      expect(config.template).toBeDefined();
      expect(config.review_rules).toBeDefined();
      expect(config.copy_rules).toBeDefined();
    });

    it('solo-company-case 应含图片配置', async () => {
      const config = await getContentType('solo-company-case');
      expect(config.images.count).toBeGreaterThan(0);
      expect(config.images.format).toBeTruthy();
    });

    it('solo-company-case 应含模板提示词', async () => {
      const config = await getContentType('solo-company-case');
      expect(config.template.research_prompt).toBeTruthy();
      expect(config.template.generate_prompt).toBeTruthy();
    });

    it('solo-company-case 应含审查规则数组', async () => {
      const config = await getContentType('solo-company-case');
      expect(Array.isArray(config.review_rules)).toBe(true);
      expect(config.review_rules.length).toBeGreaterThan(0);
    });

    it('不存在的类型应返回 null', async () => {
      const config = await getContentType('nonexistent-type-xyz');
      expect(config).toBeNull();
    });

    it('拒绝把内容类型名称解释为文件系统路径', async () => {
      await expect(getContentType('../package')).rejects.toThrow('content_type_name_invalid');
    });
  });

  describe('listContentTypes', () => {
    it('应返回包含 solo-company-case 的数组', async () => {
      const types = await listContentTypes();
      expect(Array.isArray(types)).toBe(true);
      expect(types).toContain('solo-company-case');
    });

    it('返回的数组不应包含文件扩展名', async () => {
      const types = await listContentTypes();
      for (const t of types) {
        expect(t).not.toMatch(/\.(yaml|yml)$/);
      }
    });
  });

  describe('loadAllContentTypes', () => {
    it('应加载所有类型并验证通过', async () => {
      const results = await loadAllContentTypes();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      for (const { name, config } of results) {
        expect(name).toBeTruthy();
        expect(config.content_type).toBe(name);
      }
    });
  });
});

describe('新增内容类型 — 5 个模板', () => {
  const NEW_TYPES = ['long-form', 'short-form', 'video-script', 'promo-copy', 'data-analysis'];

  it.each(NEW_TYPES)('%s 应存在且可加载', async (typeName) => {
    const config = await getContentType(typeName);
    expect(config).not.toBeNull();
    expect(config.content_type).toBe(typeName);
  });

  it.each(NEW_TYPES)('%s 应含有效图片配置', async (typeName) => {
    const config = await getContentType(typeName);
    expect(config.images).toBeDefined();
    expect(typeof config.images.count).toBe('number');
    expect(config.images.count).toBeGreaterThan(0);
  });

  it.each(NEW_TYPES)('%s 应含 generate_prompt', async (typeName) => {
    const config = await getContentType(typeName);
    expect(config.template).toBeDefined();
    expect(config.template.generate_prompt).toBeTruthy();
  });

  it.each(NEW_TYPES)('%s 应含审查规则', async (typeName) => {
    const config = await getContentType(typeName);
    expect(Array.isArray(config.review_rules)).toBe(true);
    expect(config.review_rules.length).toBeGreaterThan(0);
  });

  it('listContentTypes 应包含全部 5 个新类型', async () => {
    const types = await listContentTypes();
    for (const typeName of NEW_TYPES) {
      expect(types).toContain(typeName);
    }
  });
});

// DB 专有类型必须经真实读取器返回；由测试边界提供固定记录。
describe('DB 优先读取合同', () => {
  it('返回仅在数据库中注册的完整配置', async () => {
    const config = await getContentType('debt-12-db-only');
    expect(config).toEqual({
      content_type: 'debt-12-db-only', images: { count: 2 },
      template: { generate_prompt: 'database template' },
      review_rules: ['database review'], copy_rules: ['database copy'],
      notebook_id: 'debt-12-notebook',
    });
  });
});

describe('DB/YAML 合并与失败边界', () => {
  it('数据库配置优先于同名 YAML，且补齐 notebook_id', async () => {
    query.mockResolvedValueOnce({ rows: [{ config: {
      ...structuredClone(dbConfig), content_type: 'solo-company-case', notebook_id: null,
    } }] });
    const config = await getContentType('solo-company-case');
    expect(config.template.generate_prompt).toBe('database template');
    expect(config.notebook_id).toBe('1d928181-4462-47d4-b4c0-89d3696344ab');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE content_type = $1'), ['solo-company-case']);
  });

  it('DB 故障时读取真实 YAML 并留告警', async () => {
    query.mockRejectedValueOnce(new Error('debt-12 DB unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = await getContentType('solo-company-case');
    expect(config.content_type).toBe('solo-company-case');
    expect(config.template.generate_prompt).toBeTruthy();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('debt-12 DB unavailable'));
  });

  it('合并数据库专有类型并去除 YAML 同名重复', async () => {
    query.mockResolvedValueOnce({ rows: [
      { content_type: 'debt-12-db-only' }, { content_type: 'solo-company-case' },
    ] });
    const types = await listContentTypes();
    expect(types[0]).toBe('debt-12-db-only');
    expect(types.filter(t => t === 'solo-company-case')).toHaveLength(1);
    expect(types).toContain('long-form');
  });

  it('列表查询失败仍返回 YAML 类型并告警', async () => {
    query.mockRejectedValueOnce(new Error('debt-12 list unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await listContentTypes()).toContain('solo-company-case');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('debt-12 list unavailable'));
  });

  it('非法名称在查询 DB 前被拒绝', async () => {
    await expect(getContentType('../package')).rejects.toThrow('content_type_name_invalid');
    expect(query).not.toHaveBeenCalled();
  });
});
