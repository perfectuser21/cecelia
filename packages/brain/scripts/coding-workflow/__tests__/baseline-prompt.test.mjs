import { it, expect } from 'vitest';
import { renderPrompt } from '../lib/claude.mjs';
it('固定原文包含模板占位符时必须逐字保留，不二次解释', () => {
  expect(renderPrompt('{{BASELINE_CONTEXT}}\n{{TASK_ID}}\n{{UNKNOWN}}', { BASELINE_CONTEXT: '原规则{{TASK_ID}} $&', TASK_ID: '真实任务' })).toBe('原规则{{TASK_ID}} $&\n真实任务\n{{UNKNOWN}}');
});
