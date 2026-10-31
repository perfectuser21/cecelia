// 验证真实 executor 的 Skill 内联与参数；外置正文由固定来源专项负责。

import { describe, it, expect, vi } from 'vitest';

const skillLoader = vi.hoisted(() => vi.fn((name) => {
  if (name !== 'line-strategist') throw new Error(`unexpected skill: ${name}`);
  return 'NATIVE_STRATEGIST_SKILL_FIXTURE_83c2';
}));
vi.mock('../harness-shared.js', async importOriginal => ({
  ...await importOriginal(),
  loadSkillContent: skillLoader,
}));

const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
  execSync: vi.fn(() => ''),
}));

vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  getTaskLocation: vi.fn(() => 'us'),
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: { EXECUTOR: 'executor' },
  STATUS: { START: 'start', SUCCESS: 'success' },
  EXECUTOR_HOSTS: { US: 'us', HK: 'hk' },
}));

vi.mock('../event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../auto-learning.js', () => ({ processExecutionAutoLearning: vi.fn() }));

describe('strategist_decision — executor 执行侧接线', () => {
  it('getSkillForTaskType 对 strategist_decision 返回 /line-strategist（不是 /dev fallback）', async () => {
    const { getSkillForTaskType } = await import('../executor.js');
    expect(getSkillForTaskType('strategist_decision', {})).toBe('/line-strategist');
  });

  it('preparePrompt 对 strategist_decision 任务：inline SKILL 内容 + 注入 LINE_ID/TRIGGER/TRIGGER_CONTEXT/BRAIN_TASK_ID', async () => {
    const { preparePrompt } = await import('../executor.js');

    const task = {
      id: 'strategist-task-1',
      title: '军师决策[测试Line]: xxx',
      description: '任务终态触发（run_terminal）',
      task_type: 'strategist_decision',
      payload: {
        journey_id: 'journey-abc-123',
        trigger: 'run_terminal',
        trigger_context: { terminal_task_ids: ['t1', 't2'] },
      },
    };

    const prompt = await preparePrompt(task);

    // 1) 不能以裸 slash command 开头（容器 headless 不展开 → 空 SKILL 静默降级）
    expect(prompt.startsWith('/')).toBe(false);

    // 2) 完整内联独立 loader 返回的正文，不能回落到裸 slash
    expect(prompt).toContain('NATIVE_STRATEGIST_SKILL_FIXTURE_83c2');

    // 3) 必须注入四个参数，值来自 payload
    expect(prompt).toContain('LINE_ID: journey-abc-123');
    expect(prompt).toContain('TRIGGER: run_terminal');
    expect(prompt).toContain('BRAIN_TASK_ID: strategist-task-1');
    expect(prompt).toContain('terminal_task_ids');
  });

  it('trigger/trigger_context 缺失时有合理默认值，不抛异常（TRIGGER=manual 场景）', async () => {
    const { preparePrompt } = await import('../executor.js');

    const task = {
      id: 'strategist-task-2',
      title: '军师决策[测试Line]: manual',
      task_type: 'strategist_decision',
      payload: { journey_id: 'journey-xyz' },
    };

    const prompt = await preparePrompt(task);
    expect(prompt).toContain('TRIGGER: manual');
    expect(prompt).toContain('LINE_ID: journey-xyz');
  });
  it('外置正文加载失败必须传播，不能静默生成降级 prompt', async () => {
    const { preparePrompt } = await import('../executor.js');
    skillLoader.mockImplementationOnce(() => { throw new Error('fixture skill unavailable'); });
    await expect(preparePrompt({ id: 'strategist-missing', task_type: 'strategist_decision', payload: {} })).rejects.toThrow('fixture skill unavailable');
  });
});
