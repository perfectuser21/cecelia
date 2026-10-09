// lib/review.mjs v2：QA 立场的评审文档——5 维评分、带严重度/场景/依据的问题、上轮问题的关闭/坚持。
import { describe, it, expect } from 'vitest';
import { parseReview, openIssuesAfter } from '../lib/review.mjs';

const FM = '---\ntask_id: t\nstep: spec_review\nupstream: ["02-spec.md#S-1"]\n---\n# 规格评审\n';
const SCORES = '## 评分\n意图对齐: 8\n可验证: 6\n场景覆盖: 7\n回归风险: 9\n可执行: 8\n';
const ids = { specIds: ['S-1', 'S-2'], intentIds: ['I-1'] };
const issue = (id, { severity = '阻断', scene = '用户重复提交同一任务，第二次被当成新任务建出两条', basis = 'activities/intent.mjs 第 30 行未去重', targets = 'S-1', body = '规格没说重复提交怎么办' } = {}) =>
  [`### ${id}`, targets !== null ? `针对: ${targets}` : null, severity !== null ? `严重度: ${severity}` : null,
    scene !== null ? `场景: ${scene}` : null, basis !== null ? `依据: ${basis}` : null, body].filter((l) => l !== null).join('\n');

describe('parseReview v2', () => {
  it('解析评分、问题（严重度/场景/依据/针对/说明）', () => {
    const r = parseReview(`${FM}${SCORES}\n${issue('R-1')}\n\n${issue('R-2', { severity: '建议', scene: null, basis: null, targets: 'S-2, I-1', body: '命名可更清楚' })}\n`, ids);
    expect(r.errors).toEqual([]);
    expect(r.scores).toEqual({ 意图对齐: 8, 可验证: 6, 场景覆盖: 7, 回归风险: 9, 可执行: 8 });
    expect(r.issues).toEqual([
      { id: 'R-1', targets: ['S-1'], severity: '阻断', scene: '用户重复提交同一任务，第二次被当成新任务建出两条', basis: 'activities/intent.mjs 第 30 行未去重', body: '规格没说重复提交怎么办' },
      { id: 'R-2', targets: ['S-2', 'I-1'], severity: '建议', scene: '', basis: '', body: '命名可更清楚' },
    ]);
  });

  it('字段名可加粗、全角冒号', () => {
    const text = `${FM}## 评分\n**意图对齐**：8\n**可验证**：7\n**场景覆盖**：7\n**回归风险**：7\n**可执行**：7\n\n### R-1\n**针对**：S-1\n**严重度**：重要\n**场景**：x\n**依据**：y\n说明`;
    const r = parseReview(text, ids);
    expect(r.errors).toEqual([]);
    expect(r.issues[0].severity).toBe('重要');
  });

  it('评分缺维度或不是 0–10 整数 → score_missing / score_invalid', () => {
    const r = parseReview(`${FM}## 评分\n意图对齐: 8\n可验证: 11\n场景覆盖: 七\n回归风险: 7\n`, ids);
    expect(r.errors).toEqual(expect.arrayContaining(['score_invalid:可验证', 'score_invalid:场景覆盖', 'score_missing:可执行']));
  });

  it('阻断/重要问题必须带场景与依据（防吹毛求疵）；建议级可以不带', () => {
    const r = parseReview(`${FM}${SCORES}\n${issue('R-1', { scene: null })}\n\n${issue('R-2', { severity: '重要', basis: null })}\n\n${issue('R-3', { severity: '建议', scene: null, basis: null })}`, ids);
    expect(r.errors).toEqual(['R-1:scene_missing', 'R-2:basis_missing']);
  });

  it('缺针对 / 针对未知 ID / 缺严重度 / 严重度非法 / 说明为空', () => {
    const r = parseReview(`${FM}${SCORES}\n${issue('R-1', { targets: null })}\n\n${issue('R-2', { targets: 'S-9' })}\n\n${issue('R-3', { severity: null })}\n\n${issue('R-4', { severity: '致命' })}\n\n${issue('R-5', { body: '' })}`, ids);
    expect(r.errors).toEqual(['R-1:target_missing', 'R-2:target_unknown:S-9', 'R-3:severity_missing', 'R-4:severity_invalid', 'R-5:body_empty']);
  });

  it('上轮问题：逐条 关闭/坚持，漏掉的报 prior_missing；新问题不许复用旧编号', () => {
    const text = `${FM}${SCORES}\n## 上轮问题\n- R-1: 关闭 —— 规格已补去重\n- **R-2**：坚持 —— 驳回理由不成立，S-2 仍未处理超时\n\n${issue('R-2')}\n\n${issue('R-4')}`;
    const r = parseReview(text, { ...ids, priorIds: ['R-1', 'R-2', 'R-3'] });
    expect(r.prior).toEqual([
      { id: 'R-1', status: '关闭', reason: '规格已补去重' },
      { id: 'R-2', status: '坚持', reason: '驳回理由不成立，S-2 仍未处理超时' },
    ]);
    expect(r.errors).toEqual(expect.arrayContaining(['prior_missing:R-3', 'R-2:id_reused']));
  });

  it('非字符串输入 → 全部维度 score_missing，不抛错', () => {
    expect(parseReview(null, ids).errors).toContain('score_missing:意图对齐');
  });
});

describe('openIssuesAfter', () => {
  it('上轮未关闭（坚持或没表态）的 + 本轮新提的阻断/重要问题 = 仍开着；建议级不算', () => {
    const prevOpen = [{ id: 'R-1', severity: '阻断' }, { id: 'R-2', severity: '重要' }];
    const review = {
      prior: [{ id: 'R-1', status: '关闭', reason: '' }, { id: 'R-2', status: '坚持', reason: '' }],
      issues: [{ id: 'R-3', severity: '阻断' }, { id: 'R-4', severity: '建议' }],
    };
    expect(openIssuesAfter(prevOpen, review).map((i) => i.id)).toEqual(['R-2', 'R-3']);
  });
});
