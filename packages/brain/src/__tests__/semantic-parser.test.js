/**
 * semantic-parser.test.js
 * 语义解析器单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parse, batchParse, _internal } from '../semantic-parser.js';

// Mock 依赖
vi.mock('../entity-linker.js', () => ({
  _extractKeywords: vi.fn((text) => {
    // 简单模拟关键词提取
    return text.split(/\s+/).filter(word => word.length > 2).slice(0, 5);
  })
}));

vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn(() => Promise.resolve({
    content: '{"additional_keywords":["API"],"complexity":"medium","category":"feature"}'
  }))
}));

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(() => Promise.resolve({ rows: [] }))
  }
}));

describe('semantic-parser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parse function', () => {
    it('应该处理空输入', async () => {
      const result = await parse('');
      expect(result.keywords).toEqual([]);
      expect(result.entities).toEqual([]);
      expect(result.patterns).toEqual([]);
    });

    it('应该处理无效输入', async () => {
      const result = await parse(null);
      expect(result.keywords).toEqual([]);
      expect(result.entities).toEqual([]);
    });

    it('应该解析基本需求文本', async () => {
      const text = '添加用户登录功能';
      const result = await parse(text);

      expect(result.keywords).toBeDefined();
      expect(Array.isArray(result.keywords)).toBe(true);
      expect(result.entities).toBeDefined();
      expect(Array.isArray(result.entities)).toBe(true);
      expect(result.patterns).toBeDefined();
      expect(Array.isArray(result.patterns)).toBe(true);
      expect(typeof result.parseTime).toBe('number');
    });

    it('应该提取功能添加模式', async () => {
      const text = '添加用户登录功能';
      const result = await parse(text);

      const addPattern = result.patterns.find(p => p.type === 'feature_add');
      expect(addPattern).toBeDefined();
    });

    it('应该提取Bug修复模式', async () => {
      const text = '修复登录bug问题';
      const result = await parse(text);

      const bugPattern = result.patterns.find(p => p.type === 'bug_fix');
      expect(bugPattern).toBeDefined();
    });

    it('应该处理中英文混合文本', async () => {
      const text = 'fix登录bug和add新功能';
      const result = await parse(text);

      expect(result.keywords.length).toBeGreaterThan(0);
      expect(result.entities).toBeDefined();
    });

    it('应该在2秒内完成解析', async () => {
      const text = '这是一个复杂的需求描述文本，包含多个功能点和技术要求，需要进行详细的解析处理';
      const result = await parse(text);

      expect(result.parseTime).toBeLessThan(2000);
    });
  });

  describe('batchParse function', () => {
    it('应该处理文本数组', async () => {
      const texts = ['需求1', '需求2', '需求3'];
      const results = await batchParse(texts);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(3);

      results.forEach(result => {
        expect(result.keywords).toBeDefined();
        expect(result.entities).toBeDefined();
        expect(result.patterns).toBeDefined();
      });
    });

    it('应该处理空数组', async () => {
      const results = await batchParse([]);
      expect(results).toEqual([]);
    });

    it('应该处理无效输入', async () => {
      const results = await batchParse(null);
      expect(results).toEqual([]);
    });
  });

  describe('内部函数测试', () => {
    const { extractTechEntities, extractRequirementPatterns } = _internal;

    it('extractTechEntities 应该提取技术实体', () => {
      const text = '使用 React 和 Node.js 开发';
      const entities = extractTechEntities(text);

      expect(entities.length).toBeGreaterThan(0);
      const reactEntity = entities.find(e => e.value.toLowerCase().includes('react'));
      expect(reactEntity).toBeDefined();
    });

    it('extractRequirementPatterns 应该提取需求模式', () => {
      const text = '添加用户管理功能';
      const patterns = extractRequirementPatterns(text);

      expect(patterns.length).toBeGreaterThan(0);
      const addPattern = patterns.find(p => p.type === 'feature_add');
      expect(addPattern).toBeDefined();
    });

    it('应该正确识别UI组件', () => {
      const text = '添加一个登录按钮和输入框';
      const entities = extractTechEntities(text);

      const uiComponents = entities.filter(e => e.type === 'ui_component');
      expect(uiComponents.length).toBeGreaterThan(0);
    });

    it('应该正确识别功能模块', () => {
      const text = '实现用户认证和授权模块';
      const entities = extractTechEntities(text);

      const featureModules = entities.filter(e => e.type === 'feature_module');
      expect(featureModules.length).toBeGreaterThan(0);
    });
  });

  describe('性能测试', () => {
    it('批量处理应该高效', async () => {
      const texts = Array(10).fill('添加用户管理功能，包含登录、注册、权限控制等模块');
      const startTime = Date.now();

      const results = await batchParse(texts);
      const duration = Date.now() - startTime;

      expect(results.length).toBe(10);
      expect(duration).toBeLessThan(5000); // 10个文本5秒内完成
    });
  });

  describe('边界条件测试', () => {
    it('应该处理超长文本', async () => {
      const longText = '需求描述 '.repeat(1000);
      const result = await parse(longText);

      expect(result.keywords).toBeDefined();
      expect(result.entities.length).toBeLessThanOrEqual(10); // 限制输出
      expect(result.patterns.length).toBeLessThanOrEqual(5);
    });

    it('应该处理特殊字符', async () => {
      const text = '添加用户@#$%功能&*()';
      const result = await parse(text);

      expect(result.keywords).toBeDefined();
      expect(result.entities).toBeDefined();
    });

    it('应该处理纯英文文本', async () => {
      const text = 'Add user login feature with authentication';
      const result = await parse(text);

      expect(result.keywords.length).toBeGreaterThan(0);
      expect(result.entities).toBeDefined();
    });

    it('应该处理纯中文文本', async () => {
      const text = '添加用户登录功能，包含身份验证';
      const result = await parse(text);

      expect(result.keywords.length).toBeGreaterThan(0);
      expect(result.entities).toBeDefined();
    });
  });
});