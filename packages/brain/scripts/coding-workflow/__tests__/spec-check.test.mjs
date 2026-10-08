import { describe, it, expect } from 'vitest';
import { SPEC_FILE, INTENT_FILE, specErrors, specIds } from '../lib/spec-check.mjs';

const TASK = 't-1';
const fm = (upstream, step = 'spec') => `---\ntask_id: ${TASK}\nstep: ${step}\nupstream: ${JSON.stringify(upstream)}\n---\n`;
const FULL = ['01-intent.md#I-1', '01-intent.md#I-2'];

describe('lib/spec-check', () => {
  it('常量', () => {
    expect(SPEC_FILE).toBe('02-spec.md');
    expect(INTENT_FILE).toBe('01-intent.md');
  });

  it('合法 02 -> 无错误', () => {
    expect(specErrors(`${fm(FULL)}# spec\n\n### S-1 说明\n内容\n`, TASK, ['I-1', 'I-2'])).toEqual([]);
  });

  it('upstream 未覆盖 + 无 S-n -> not_covered 与 spec_ids_missing', () => {
    const errors = specErrors(`${fm(FULL.slice(0, 1))}# spec\n\n#### 规格 1\n`, TASK, ['I-1', 'I-2']);
    expect(errors).toEqual(['not_covered:I-2', 'spec_ids_missing']);
  });

  it('step 不对 -> step_mismatch', () => {
    expect(specErrors(`${fm(FULL, 'build')}### S-1\n`, TASK, ['I-1', 'I-2'])).toEqual(['step_mismatch']);
  });

  it('specIds 按顺序返回正文 S-n，忽略其他锚点与 frontmatter', () => {
    expect(specIds(`${fm(FULL)}### S-2 b\n### I-9\n### S-1\n### S-10：c\n`)).toEqual(['S-2', 'S-1', 'S-10']);
  });

  it('specIds 无 frontmatter 时扫全文', () => {
    expect(specIds('### S-1\n### R-1\n')).toEqual(['S-1']);
  });
});
