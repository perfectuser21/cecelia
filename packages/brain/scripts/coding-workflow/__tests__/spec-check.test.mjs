import { describe, it, expect } from 'vitest';
import { SPEC_FILE, INTENT_FILE, specErrors, specIds, qaScenarios } from '../lib/spec-check.mjs';

const TASK = 't-1';
const fm = (upstream, step = 'spec') => `---\ntask_id: ${TASK}\nstep: ${step}\nupstream: ${JSON.stringify(upstream)}\n---\n`;
const FULL = ['01-intent.md#I-1', '01-intent.md#I-2'];
const qa = (id, { covers = 'I-1', pre = '测试库有一条 queued 任务', steps = '用户 POST /api/brain/tasks 再 GET 该任务', expect = '返回 200 且 status 为 queued' } = {}) =>
  [`### ${id}`, covers !== null ? `对应: ${covers}` : null, pre !== null ? `前提: ${pre}` : null,
    steps !== null ? `操作: ${steps}` : null, expect !== null ? `期望: ${expect}` : null].filter((l) => l !== null).join('\n');
const QA_OK = `## QA 场景\n\n${qa('Q-1')}\n\n${qa('Q-2', { covers: 'I-2' })}\n`;

describe('lib/spec-check', () => {
  it('常量', () => {
    expect(SPEC_FILE).toBe('02-spec.md');
    expect(INTENT_FILE).toBe('01-intent.md');
  });

  it('合法 02（含覆盖全部 I-n 的 QA 场景）-> 无错误', () => {
    expect(specErrors(`${fm(FULL)}# spec\n\n### S-1 说明\n内容\n\n${QA_OK}`, TASK, ['I-1', 'I-2'])).toEqual([]);
  });

  it('upstream 未覆盖 + 无 S-n -> not_covered 与 spec_ids_missing', () => {
    const errors = specErrors(`${fm(FULL.slice(0, 1))}# spec\n\n#### 规格 1\n\n${QA_OK}`, TASK, ['I-1', 'I-2']);
    expect(errors).toEqual(['not_covered:I-2', 'spec_ids_missing']);
  });

  it('step 不对 -> step_mismatch', () => {
    expect(specErrors(`${fm(FULL, 'build')}### S-1\n\n${QA_OK}`, TASK, ['I-1', 'I-2'])).toEqual(['step_mismatch']);
  });

  it('没有任何 QA 场景 -> qa_missing', () => {
    expect(specErrors(`${fm(FULL)}### S-1\n`, TASK, ['I-1', 'I-2'])).toEqual(['qa_missing']);
  });

  it('有 I-n 没被任何 Q-n 覆盖 -> qa_not_covered:I-n', () => {
    expect(specErrors(`${fm(FULL)}### S-1\n\n## QA 场景\n\n${qa('Q-1')}\n`, TASK, ['I-1', 'I-2'])).toEqual(['qa_not_covered:I-2']);
  });

  it('Q-n 缺 对应/操作/期望、对应未知 I-n -> 逐条报错；前提可省略', () => {
    const text = `${fm(FULL)}### S-1\n\n## QA 场景\n\n${qa('Q-1', { covers: null })}\n\n${qa('Q-2', { steps: null, pre: null })}\n\n${qa('Q-3', { expect: null })}\n\n${qa('Q-4', { covers: 'I-1, I-9' })}\n\n${qa('Q-5', { covers: 'I-2' })}\n`;
    expect(specErrors(text, TASK, ['I-1', 'I-2'])).toEqual(['Q-1:covers_missing', 'Q-2:steps_missing', 'Q-3:expect_missing', 'Q-4:covers_unknown:I-9']);
  });

  it('qaScenarios 解析字段（可加粗、全角冒号、多行操作）', () => {
    const text = `${fm(FULL)}### S-1\n\n## QA 场景\n\n### Q-1 正常提交\n**对应**：I-1、I-2\n前提: 无\n操作: 1. 打开页面\n2. 点提交\n期望: 页面出现「已提交」\n`;
    expect(qaScenarios(text)).toEqual([
      { id: 'Q-1', covers: ['I-1', 'I-2'], pre: '无', steps: '1. 打开页面\n2. 点提交', expect: '页面出现「已提交」' },
    ]);
  });

  it('specIds 按顺序返回正文 S-n，忽略其他锚点（含 Q-n）与 frontmatter', () => {
    expect(specIds(`${fm(FULL)}### S-2 b\n### I-9\n### S-1\n### Q-1\n### S-10：c\n`)).toEqual(['S-2', 'S-1', 'S-10']);
  });

  it('specIds 无 frontmatter 时扫全文', () => {
    expect(specIds('### S-1\n### R-1\n')).toEqual(['S-1']);
  });
});
