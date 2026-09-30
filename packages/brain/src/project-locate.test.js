/**
 * project-locate.js 单测（链 2afa6d69 棒3，任务 8a40825a）
 *
 * 覆盖：中文 bigram 分词 / 关键词重叠打分（Jaccard） / scoreProjectCandidates 编排
 * （embedding 可用走 embedding、embedding 抛错或超时 800ms 回退关键词，reason 标明用了哪种）/
 * threshold 解析（默认 0.55，env PROJECT_LOCATE_THRESHOLD 可调，非法值回退默认）。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  tokenizeBigram,
  keywordOverlapScore,
  projectCandidateText,
  scoreProjectCandidates,
  resolveProjectLocateThreshold,
  DEFAULT_PROJECT_LOCATE_THRESHOLD,
} from './project-locate.js';

describe('tokenizeBigram', () => {
  it('中文文本按相邻 2 字切分（bigram）', () => {
    expect(tokenizeBigram('获客链路优化')).toEqual(['获客', '客链', '链路', '路优', '优化']);
  });

  it('英文/数字按词切分（保留原样，不拆 bigram）', () => {
    expect(tokenizeBigram('fix login bug')).toEqual(['fix', 'login', 'bug']);
  });

  it('中英混合：中文段各自 bigram，英文段整词保留', () => {
    expect(tokenizeBigram('抖音 publish 发布')).toEqual(
      expect.arrayContaining(['抖音', 'publish', '发布'])
    );
  });

  it('空输入返回空数组', () => {
    expect(tokenizeBigram('')).toEqual([]);
    expect(tokenizeBigram(null)).toEqual([]);
    expect(tokenizeBigram(undefined)).toEqual([]);
  });
});

describe('keywordOverlapScore', () => {
  it('高度重叠文本得分明显高于无关文本', () => {
    const related = keywordOverlapScore('获客链路优化', '智能获客链路第三期优化');
    const unrelated = keywordOverlapScore('获客链路优化', '微信客服RPA排障');
    expect(related).toBeGreaterThan(unrelated);
    expect(related).toBeGreaterThan(0);
  });

  it('完全相同文本得分为 1', () => {
    expect(keywordOverlapScore('抖音发布', '抖音发布')).toBe(1);
  });

  it('任一侧为空返回 0', () => {
    expect(keywordOverlapScore('', '抖音发布')).toBe(0);
    expect(keywordOverlapScore('抖音发布', '')).toBe(0);
  });
});

describe('projectCandidateText', () => {
  it('拼接 name/description/brief.goal/brief.status，忽略缺失字段', () => {
    const text = projectCandidateText({
      name: '智能获客',
      description: '获客链路',
      brief: { goal: '第三期上线', status: '进行中' },
    });
    expect(text).toContain('智能获客');
    expect(text).toContain('获客链路');
    expect(text).toContain('第三期上线');
    expect(text).toContain('进行中');
  });

  it('brief 缺失/非对象不报错', () => {
    expect(() => projectCandidateText({ name: 'p1', description: null, brief: null })).not.toThrow();
    expect(projectCandidateText({ name: 'p1' })).toBe('p1');
  });
});

describe('scoreProjectCandidates', () => {
  const candidates = [
    { id: 'p-match', name: '智能获客链路', description: '抖音快手获客', brief: {} },
    { id: 'p-other', name: '微信客服排障', description: '个微 RPA 客服', brief: {} },
    { id: 'p-empty', name: '杂项', description: '', brief: {} },
  ];

  it('无 embedFn（或未配置 key）时回退关键词打分，reason 标 keyword', async () => {
    const result = await scoreProjectCandidates('获客链路优化', candidates, {
      embedFn: undefined,
    });
    expect(result.method).toBe('keyword');
    const match = result.scored.find((c) => c.id === 'p-match');
    const other = result.scored.find((c) => c.id === 'p-other');
    expect(match.score).toBeGreaterThan(other.score);
  });

  it('embedFn 正常返回向量时走 embedding，按余弦相似度排序', async () => {
    const vectors = {
      '获客链路优化': [1, 0, 0],
      '智能获客链路 抖音快手获客': [0.9, 0.1, 0],
      '微信客服排障 个微 RPA 客服': [0, 1, 0],
      '杂项': [0, 0, 1],
    };
    const embedFn = vi.fn(async (text) => vectors[text] ?? [0, 0, 0]);
    const result = await scoreProjectCandidates('获客链路优化', candidates, { embedFn, timeoutMs: 800 });
    expect(result.method).toBe('embedding');
    const match = result.scored.find((c) => c.id === 'p-match');
    const other = result.scored.find((c) => c.id === 'p-other');
    expect(match.score).toBeGreaterThan(other.score);
    expect(match.score).toBeGreaterThan(0.9);
  });

  it('embedFn 抛错时整体回退关键词打分（不是部分候选）', async () => {
    const embedFn = vi.fn(async () => { throw new Error('OPENAI_API_KEY not set'); });
    const result = await scoreProjectCandidates('获客链路优化', candidates, { embedFn });
    expect(result.method).toBe('keyword');
    expect(embedFn).toHaveBeenCalled();
  });

  it('embedFn 超过 timeoutMs 未完成时回退关键词打分', async () => {
    const embedFn = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve([1, 0, 0]), 50)));
    const result = await scoreProjectCandidates('获客链路优化', candidates, { embedFn, timeoutMs: 5 });
    expect(result.method).toBe('keyword');
  });

  it('候选为空数组时安全返回空 scored', async () => {
    const result = await scoreProjectCandidates('任意', [], { embedFn: undefined });
    expect(result.scored).toEqual([]);
  });
});

describe('resolveProjectLocateThreshold', () => {
  it('默认 0.55', () => {
    expect(resolveProjectLocateThreshold({})).toBe(DEFAULT_PROJECT_LOCATE_THRESHOLD);
    expect(DEFAULT_PROJECT_LOCATE_THRESHOLD).toBe(0.55);
  });

  it('env PROJECT_LOCATE_THRESHOLD 合法数值可覆盖', () => {
    expect(resolveProjectLocateThreshold({ PROJECT_LOCATE_THRESHOLD: '0.7' })).toBe(0.7);
  });

  it('env 非法值回退默认', () => {
    expect(resolveProjectLocateThreshold({ PROJECT_LOCATE_THRESHOLD: 'abc' })).toBe(DEFAULT_PROJECT_LOCATE_THRESHOLD);
  });
});
