import { describe, it, expect } from 'vitest';
import { parseReviewBlock, ParseError } from '../review-parser.js';

const FULL_BLOCK = `## Review（autonomous，B-5 spec approval）

**依据**：
- 用户的话：对话 2026-04-20 建立 Structured Review Block 规范
- 代码：packages/brain/src/review-parser.js 新建
- OKR：Cecelia Engine KR /dev 自主化闭环

**判断**：APPROVE

**confidence**：HIGH

**质量分**：9/10

**风险**：
- R1：migration 241 号可能被占用
- R2：markdown 容错需要覆盖边界

**下一步**：进入 writing-plans`;

describe('review-parser', () => {
  it('解析完整 block 字段齐全', () => {
    const r = parseReviewBlock(FULL_BLOCK);
    expect(r.point_code).toBe('B-5');
    expect(r.decision).toBe('APPROVE');
    expect(r.confidence).toBe('HIGH');
    expect(r.quality_score).toBe(9);
    expect(r.risks).toHaveLength(2);
    expect(r.risks[0].risk).toBe('R1');
    expect(r.risks[0].impact).toContain('migration 241');
    expect(r.anchors_user_words).toContain('2026-04-20');
    expect(r.anchors_code).toContain('review-parser');
    expect(r.anchors_okr).toContain('KR');
    expect(r.next_step).toBe('进入 writing-plans');
    expect(r.raw_markdown).toBe(FULL_BLOCK);
  });

  it('缺字段时 fallback null，不抛', () => {
    const minimal = `## Review（autonomous，SDD-3 code quality）
**判断**：REQUEST_CHANGES
**confidence**：LOW
**质量分**：4/10`;
    const r = parseReviewBlock(minimal);
    expect(r.point_code).toBe('SDD-3');
    expect(r.decision).toBe('REQUEST_CHANGES');
    expect(r.confidence).toBe('LOW');
    expect(r.quality_score).toBe(4);
    expect(r.anchors_user_words).toBeNull();
    expect(r.risks).toEqual([]);
    expect(r.next_step).toBeNull();
  });

  it('空输入抛 ParseError', () => {
    expect(() => parseReviewBlock('')).toThrow(ParseError);
    expect(() => parseReviewBlock(null)).toThrow(ParseError);
  });

  it('缺 Review header 抛 ParseError', () => {
    expect(() => parseReviewBlock('some random markdown without header')).toThrow(ParseError);
  });

  it('point_code 支持 B-4/B-5/B-6/SDD-2/SDD-3', () => {
    const codes = ['B-4', 'B-5', 'B-6', 'SDD-2', 'SDD-3'];
    for (const c of codes) {
      const r = parseReviewBlock(`## Review（autonomous，${c} xxx）
**判断**：APPROVE
**confidence**：HIGH
**质量分**：8/10`);
      expect(r.point_code).toBe(c);
    }
  });

  it('risks 用中英冒号都能分 risk/impact', () => {
    const block = `## Review（autonomous，B-6 self）
**判断**：APPROVE
**confidence**：HIGH
**质量分**：8/10
**风险**：
- Alpha：impact-a
- Beta: impact-b
- NoImpactRisk`;
    const r = parseReviewBlock(block);
    expect(r.risks).toHaveLength(3);
    expect(r.risks[0]).toEqual({ risk: 'Alpha', impact: 'impact-a' });
    expect(r.risks[1]).toEqual({ risk: 'Beta', impact: 'impact-b' });
    expect(r.risks[2]).toEqual({ risk: 'NoImpactRisk', impact: null });
  });
});
