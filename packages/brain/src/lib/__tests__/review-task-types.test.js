import { describe, it, expect } from 'vitest';
import { REVIEW_TASK_TYPES } from '../review-task-types.js';

describe('REVIEW_TASK_TYPES', () => {
  it('包含所有走 Codex CLI 的审查类型', () => {
    expect(REVIEW_TASK_TYPES).toContain('arch_review');
    expect(REVIEW_TASK_TYPES).toContain('code_review');
    expect(REVIEW_TASK_TYPES).toContain('initiative_review');
    expect(REVIEW_TASK_TYPES).toContain('prd_review');
    expect(REVIEW_TASK_TYPES).toContain('spec_review');
    expect(REVIEW_TASK_TYPES).toContain('code_review_gate');
    expect(REVIEW_TASK_TYPES).toContain('decomp_review');
    expect(REVIEW_TASK_TYPES).toContain('initiative_plan');
    expect(REVIEW_TASK_TYPES).toContain('initiative_verify');
    expect(REVIEW_TASK_TYPES).toContain('architecture_design');
    expect(REVIEW_TASK_TYPES).toContain('architecture_scan');
  });

  it('不包含 dev（dev 任务走 cecelia-run）', () => {
    expect(REVIEW_TASK_TYPES).not.toContain('dev');
  });

  it('是数组', () => {
    expect(Array.isArray(REVIEW_TASK_TYPES)).toBe(true);
  });
});
