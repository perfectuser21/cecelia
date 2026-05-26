import { describe, it, expect } from 'vitest';
import { buildGeneratorPrompt } from '../harness-utils.js';

const TASK = {
  id: 'ws1',
  title: 'test task',
  description: 'test description',
  payload: { dod: ['item1'], files: ['file.js'], parent_task_id: 'init1', logical_task_id: 'ws1' },
};

describe('buildGeneratorPrompt — prdContent injection', () => {
  it('includes Sprint PRD section when prdContent provided', () => {
    const prompt = buildGeneratorPrompt(TASK, { prdContent: '# My PRD\nGoal: do stuff' });
    expect(prompt).toContain('## Sprint PRD');
    expect(prompt).toContain('# My PRD');
  });

  it('omits Sprint PRD section when prdContent is null', () => {
    const prompt = buildGeneratorPrompt(TASK, { prdContent: null });
    expect(prompt).not.toContain('## Sprint PRD');
  });

  it('Sprint PRD appears before DoD section', () => {
    const prompt = buildGeneratorPrompt(TASK, { prdContent: 'PRD content here' });
    const prdIdx = prompt.indexOf('## Sprint PRD');
    const dodIdx = prompt.indexOf('## DoD');
    expect(prdIdx).toBeGreaterThan(-1);
    expect(prdIdx).toBeLessThan(dodIdx);
  });

  it('backward compatible — prdContent defaults to null (no Sprint PRD section)', () => {
    const prompt = buildGeneratorPrompt(TASK);
    expect(prompt).not.toContain('## Sprint PRD');
    expect(prompt).toContain('## DoD');
  });
});
