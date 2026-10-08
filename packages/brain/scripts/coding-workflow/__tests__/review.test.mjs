import { describe, it, expect } from 'vitest';
import { parseReview } from '../lib/review.mjs';

const FM = '---\ntask_id: t-1\nstep: review\nupstream: ["02-spec.md#S-1"]\n---\n';
const IDS = { specIds: ['S-1', 'S-2'], intentIds: ['I-1', 'I-2'] };
const R1 = '### R-1 接口命名\n针对: S-1, I-2\nS-1 的导出名与 intent 不一致。\n';

describe('parseReview：verdict 行写法', () => {
  it.each([
    ['普通写法', 'verdict: APPROVE', 'APPROVE'],
    ['小写', 'verdict: revise', 'REVISE'],
    ['加粗字段名', '**verdict**: revise', 'REVISE'],
    ['整行加粗', '**verdict: REVISE**', 'REVISE'],
    ['全角冒号', 'Verdict：Approve', 'APPROVE'],
  ])('%s', (_name, line, expected) => {
    const { verdict } = parseReview(`# 评审\n\n${line}\n\n${R1}`, IDS);
    expect(verdict).toBe(expected);
  });

  it('取第一处 verdict 行', () => {
    expect(parseReview('verdict: APPROVE\nverdict: REVISE\n', IDS).verdict).toBe('APPROVE');
  });
});

describe('parseReview：R-n 问题小节', () => {
  it('解析 id / targets / body', () => {
    const { issues } = parseReview(`verdict: REVISE\n\n${R1}`, IDS);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({ id: 'R-1', targets: ['S-1', 'I-2'], body: expect.any(String) });
    expect(issues[0].body).not.toBe('');
  });

  it('加粗针对行与中文分隔符', () => {
    const text = 'verdict: REVISE\n### R-1\n**针对**：S-1，I-1、S-2\n描述\n';
    expect(parseReview(text, IDS).issues[0].targets).toEqual(['S-1', 'I-1', 'S-2']);
  });

  it('小节到下一个 #~### 标题结束，#### 不结束', () => {
    const text = 'verdict: REVISE\n### R-1\n针对: S-1\n描述 A\n#### 细节\n描述 B\n## 其他\n无关\n';
    const { issues } = parseReview(text, IDS);
    expect(issues[0].body).toContain('描述 B');
    expect(issues[0].body).not.toContain('无关');
  });

  it('多个 R-n 按出现顺序', () => {
    const text = `verdict: REVISE\n${R1}\n### R-2\n针对: I-1\n另一个问题\n`;
    expect(parseReview(text, IDS).issues.map((i) => i.id)).toEqual(['R-1', 'R-2']);
  });

  it('带 frontmatter 与不带 frontmatter 均可解析', () => {
    const body = `verdict: REVISE\n\n${R1}`;
    const a = parseReview(FM + body, IDS);
    const b = parseReview(body, IDS);
    expect(a).toEqual(b);
    expect(a.verdict).toBe('REVISE');
    expect(a.errors).toEqual([]);
  });

  it('非字符串输入按空串处理', () => {
    expect(parseReview(undefined)).toEqual({ verdict: null, issues: [], errors: ['verdict_missing'] });
  });
});

describe('parseReview：错误码', () => {
  it('无 verdict 行 → verdict_missing', () => {
    const r = parseReview(`# 评审\n${R1}`, IDS);
    expect(r.verdict).toBeNull();
    expect(r.errors).toContain('verdict_missing');
  });

  it('verdict: MAYBE → verdict_invalid', () => {
    const r = parseReview('verdict: MAYBE\n', IDS);
    expect(r.verdict).toBeNull();
    expect(r.errors).toContain('verdict_invalid');
  });

  it('REVISE 无 R-n → issues_missing', () => {
    expect(parseReview('verdict: REVISE\n', IDS).errors).toContain('issues_missing');
  });

  it('R-1 无针对行 → R-1:target_missing', () => {
    const r = parseReview('verdict: REVISE\n### R-1\n只有描述\n', IDS);
    expect(r.issues[0].targets).toEqual([]);
    expect(r.errors).toContain('R-1:target_missing');
  });

  it('针对行切分后无 ID → target_missing', () => {
    expect(parseReview('verdict: REVISE\n### R-1\n针对: ，、\n描述\n', IDS).errors).toContain('R-1:target_missing');
  });

  it('R-2 仅有针对行无描述 → R-2:body_empty', () => {
    const r = parseReview(`verdict: REVISE\n${R1}\n### R-2\n针对: S-1\n\n`, IDS);
    expect(r.errors).toContain('R-2:body_empty');
    expect(r.errors).not.toContain('R-1:body_empty');
  });

  it('未知目标 ID → R-1:target_unknown:S-9', () => {
    const r = parseReview('verdict: REVISE\n### R-1\n针对: S-9\n描述\n', { specIds: ['S-1'], intentIds: ['I-1'] });
    expect(r.errors).toContain('R-1:target_unknown:S-9');
  });

  it('APPROVE + 合法 R-1 → errors 为空', () => {
    const r = parseReview(`verdict: APPROVE\n${R1}`, IDS);
    expect(r.errors).toEqual([]);
    expect(r.issues.length).toBe(1);
  });

  it('APPROVE 不带 R-n → errors 为空', () => {
    expect(parseReview('verdict: APPROVE\n', IDS).errors).toEqual([]);
  });

  it('REVISE + 合法 R-1（针对 S-1, I-1）→ errors 为空', () => {
    const r = parseReview('verdict: REVISE\n### R-1\n针对: S-1, I-1\n描述\n', { specIds: ['S-1'], intentIds: ['I-1'] });
    expect(r.errors).toEqual([]);
  });
});
