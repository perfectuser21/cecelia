import { describe, it, expect, vi } from 'vitest';

const skillLoader = vi.hoisted(() => vi.fn((name) => {
  if (name !== 'ci-patrol') throw new Error(`unexpected skill: ${name}`);
  return 'NATIVE_CI_PATROL_SKILL_FIXTURE_92d3';
}));
vi.mock('../harness-shared.js', async importOriginal => ({
  ...await importOriginal(),
  loadSkillContent: skillLoader,
}));

import * as executor from '../executor.js';

// 容器内 headless `claude -p` 不展开 slash command（同 harness-report Bug B / strategist 模式）。
// ci_patrol 首日 4 次真机运行实证：默认路径的裸 `/ci-patrol` 让容器 agent 零 SKILL 指令即兴发挥，
// 日报只活在 stdout、notes/棘轮全没写、任务却 completed——假成功。必须 _TASK_ROUTES 内联。
describe('executor: ci_patrol prompt 内联', () => {
  const task = {
    id: 'test-ci-patrol-id',
    task_type: 'ci_patrol',
    title: '[ci-patrol] 测试',
    payload: { date: '2026-07-10', trigger: 'manual' },
  };

  it('preparePrompt 返回完整内联 SKILL 而非裸 /ci-patrol slash', async () => {
    const prompt = await executor.preparePrompt(task);
    expect(prompt).toContain('NATIVE_CI_PATROL_SKILL_FIXTURE_92d3');
    expect(prompt).toContain('BRAIN_TASK_ID: test-ci-patrol-id');
    expect(prompt.trim().startsWith('/ci-patrol')).toBe(false); // 不是裸 slash 形式
  });
  it('外置正文加载失败必须传播，不能静默生成降级 prompt', async () => {
    const { preparePrompt } = await import('../executor.js');
    skillLoader.mockImplementationOnce(() => { throw new Error('fixture skill unavailable'); });
    await expect(preparePrompt({ id: 'patrol-missing', task_type: 'ci_patrol', payload: {} })).rejects.toThrow('fixture skill unavailable');
  });
});
