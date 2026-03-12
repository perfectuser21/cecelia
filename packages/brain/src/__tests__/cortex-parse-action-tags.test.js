/**
 * Tests for parseActionTags — 从 LLM 输出文本提取 [ACTION:] 标签
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

let parseActionTags;

beforeAll(async () => {
  vi.resetModules();
  // mock db 避免 pool 连接
  vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
  vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn() }));
  ({ parseActionTags } = await import('../cortex.js'));
});

describe('parseActionTags', () => {
  describe('正常场景', () => {
    it('解析单个 ACTION 标签（含 priority）', () => {
      const text = '我决定 [ACTION: 修复 quota 熔断缺口 priority=P0] 立即执行';
      const result = parseActionTags(text);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('修复 quota 熔断缺口');
      expect(result[0].priority).toBe('P0');
      expect(result[0].skill).toBe('dev');
    });

    it('解析含 skill 参数的 ACTION 标签', () => {
      const text = '[ACTION: 优化告警聚合逻辑 priority=P1 skill=ops]';
      const result = parseActionTags(text);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('优化告警聚合逻辑');
      expect(result[0].priority).toBe('P1');
      expect(result[0].skill).toBe('ops');
    });

    it('多行文本中解析多个 ACTION 标签', () => {
      const text = `
皮层分析完成：
- [ACTION: 修复熔断缺口 priority=P0]
- 建议增加监控
- [ACTION: 补充单元测试 priority=P2 skill=qa]
总结完毕
      `;
      const result = parseActionTags(text);
      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('修复熔断缺口');
      expect(result[0].priority).toBe('P0');
      expect(result[1].title).toBe('补充单元测试');
      expect(result[1].priority).toBe('P2');
      expect(result[1].skill).toBe('qa');
    });

    it('ACTION 标签无 priority 时默认 P1', () => {
      const text = '[ACTION: 更新文档]';
      const result = parseActionTags(text);
      expect(result).toHaveLength(1);
      expect(result[0].priority).toBe('P1');
      expect(result[0].skill).toBe('dev');
    });
  });

  describe('空/无效输入场景', () => {
    it('空字符串返回空数组', () => {
      expect(parseActionTags('')).toEqual([]);
    });

    it('null/undefined 返回空数组', () => {
      expect(parseActionTags(null)).toEqual([]);
      expect(parseActionTags(undefined)).toEqual([]);
    });

    it('no action 标签的文本返回空数组', () => {
      const text = '这段文字没有任何动作标签，只是普通分析文本。';
      expect(parseActionTags(text)).toEqual([]);
    });
  });

  describe('格式错误场景', () => {
    it('ACTION 标签内容为空时忽略', () => {
      const text = '[ACTION: ] 这个标签内容为空';
      const result = parseActionTags(text);
      expect(result).toEqual([]);
    });

    it('大小写和多余空格正常解析', () => {
      const text = '[ACTION:   整理技术债务   priority=P1  ]';
      const result = parseActionTags(text);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('整理技术债务');
    });

    it('非字符串类型返回空数组', () => {
      expect(parseActionTags(42)).toEqual([]);
      expect(parseActionTags({})).toEqual([]);
    });
  });
});
