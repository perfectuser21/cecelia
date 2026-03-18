import { describe, it, expect } from 'vitest';
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
