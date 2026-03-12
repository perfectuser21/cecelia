/**
 * cortex.js — parseActionTags 单元测试
 *
 * 覆盖：正常单标签 / 多标签 / 空输入 / 格式错误
 */

import { describe, it, expect, vi } from 'vitest';

// ── Mocks（cortex.js 依赖重度外部模块，全部 mock 掉）──────────────────────────
// 注意：vi.mock 被提升到文件顶部，factory 中不能引用文件顶层变量（const 暂时性死区）
// 因此 db.js mock 直接在 factory 内创建对象，不引用外部变量

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

vi.mock('../thalamus.js', () => ({
  ACTION_WHITELIST: {
    request_human_review: { dangerous: false, description: 'Request human review' },
  },
  validateDecision: vi.fn(),
  recordLLMError: vi.fn(),
  recordTokenUsage: vi.fn(),
}));

vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn() }));
vi.mock('../learning.js', () => ({ searchRelevantLearnings: vi.fn().mockResolvedValue([]) }));
vi.mock('../self-model.js', () => ({ getSelfModel: vi.fn().mockResolvedValue({}) }));
vi.mock('../memory-utils.js', () => ({ generateL0Summary: vi.fn().mockResolvedValue('') }));
vi.mock('../cortex-quality.js', () => ({
  evaluateQualityInitial: vi.fn().mockResolvedValue({}),
  generateSimilarityHash: vi.fn().mockReturnValue('hash'),
  checkShouldCreateRCA: vi.fn().mockResolvedValue({ should_create: true }),
}));
vi.mock('../policy-validator.js', () => ({ validatePolicyJson: vi.fn().mockReturnValue({ valid: true }) }));
vi.mock('../circuit-breaker.js', () => ({ recordFailure: vi.fn() }));
vi.mock('../actions.js', () => ({ createTask: vi.fn() }));

// ── 导入被测函数 ───────────────────────────────────────────────────────────────

import { parseActionTags } from '../cortex.js';

// ── 测试 ───────────────────────────────────────────────────────────────────────

describe('parseActionTags', () => {
  describe('正常场景', () => {
    it('单个 ACTION 标签，带 priority', () => {
      const text = '我决定 [ACTION: 修复 quota 熔断缺口 priority=P0] 立即执行';
      const result = parseActionTags(text);

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('修复 quota 熔断缺口');
      expect(result[0].priority).toBe('P0');
      expect(result[0].skill).toBe('dev');
    });

    it('单个 ACTION 标签，带 priority 和 skill', () => {
      const text = '[ACTION: 代码审计 CI 流程 priority=P1 skill=audit]';
      const result = parseActionTags(text);

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('代码审计 CI 流程');
      expect(result[0].priority).toBe('P1');
      expect(result[0].skill).toBe('audit');
    });

    it('无 kv 参数时使用默认值 priority=P1 skill=dev', () => {
      const text = '[ACTION: 重启任务调度]';
      const result = parseActionTags(text);

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('重启任务调度');
      expect(result[0].priority).toBe('P1');
      expect(result[0].skill).toBe('dev');
    });

    it('多行多个 ACTION 标签', () => {
      const text = `分析完成，建议如下：
[ACTION: 修复 quota 熔断缺口 priority=P0]
下一步需要
[ACTION: 更新 selfcheck 版本号 priority=P1 skill=dev]
另外：
[ACTION: 生成 RCA 报告 priority=P2 skill=audit]`;

      const result = parseActionTags(text);

      expect(result).toHaveLength(3);
      expect(result[0].title).toBe('修复 quota 熔断缺口');
      expect(result[0].priority).toBe('P0');

      expect(result[1].title).toBe('更新 selfcheck 版本号');
      expect(result[1].priority).toBe('P1');
      expect(result[1].skill).toBe('dev');

      expect(result[2].title).toBe('生成 RCA 报告');
      expect(result[2].priority).toBe('P2');
      expect(result[2].skill).toBe('audit');
    });
  });

  describe('空/无效输入场景', () => {
    it('空字符串返回空数组', () => {
      expect(parseActionTags('')).toEqual([]);
    });

    it('null 返回空数组', () => {
      expect(parseActionTags(null)).toEqual([]);
    });

    it('undefined 返回空数组', () => {
      expect(parseActionTags(undefined)).toEqual([]);
    });

    it('无 ACTION 标签的文本返回空数组', () => {
      const text = '这是普通的 LLM 输出，没有任何动作标记。';
      expect(parseActionTags(text)).toEqual([]);
    });
  });

  describe('格式错误场景', () => {
    it('ACTION 标签内容为空（只有空格）时跳过', () => {
      const text = '[ACTION:   ]';
      expect(parseActionTags(text)).toEqual([]);
    });

    it('ACTION 标签只有 key=value 无 title 时跳过', () => {
      const text = '[ACTION: priority=P0 skill=dev]';
      const result = parseActionTags(text);
      // title 会是空字符串，应被过滤掉
      expect(result).toHaveLength(0);
    });

    it('非标准大写 ACTION 标签不匹配', () => {
      const text = '[action: 修复 bug priority=P0]';
      expect(parseActionTags(text)).toEqual([]);
    });

    it('方括号未闭合时不匹配', () => {
      const text = '[ACTION: 修复 bug priority=P0';
      expect(parseActionTags(text)).toEqual([]);
    });

    it('混合有效和无效标签只返回有效的', () => {
      const text = '[ACTION: 有效任务 priority=P1] 中间文本 [ACTION:   ] 末尾';
      const result = parseActionTags(text);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('有效任务');
    });
  });
});
