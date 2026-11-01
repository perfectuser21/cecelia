import { describe, it, expect, vi } from 'vitest';

const skillLoader = vi.hoisted(() => vi.fn(name => {
  if (name !== 'harness-generator') throw new Error(`unexpected skill: ${name}`);
  return 'NATIVE_GENERATOR_PRD_CONTENT_FIXTURE_9c1e';
}));
vi.mock('../harness-shared.js', async importOriginal => ({
  ...await importOriginal(),
  loadSkillContent: skillLoader,
}));

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
    expect(prompt).toContain('NATIVE_GENERATOR_PRD_CONTENT_FIXTURE_9c1e');
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

  it('Skill provider失败时不能生成只有PRD/DoD的降级prompt', () => {
    const failure = new Error('fixture missing harness-generator skill');
    skillLoader.mockImplementationOnce(() => { throw failure; });
    let received;
    try { buildGeneratorPrompt(TASK, { prdContent: '# available PRD' }); } catch (error) { received = error; }
    expect(received).toBe(failure);
  });
});
