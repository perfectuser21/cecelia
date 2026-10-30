// 验证真实 executor 的 Skill 内联与参数；外置正文由固定来源专项负责。

import { describe, it, expect, vi } from 'vitest';

const skillLoader = vi.hoisted(() => vi.fn((name) => {
  if (name !== 'harness-report') throw new Error(`unexpected skill: ${name}`);
  return 'NATIVE_REPORT_SKILL_FIXTURE_74b1';
}));
vi.mock('../harness-shared.js', async importOriginal => ({
  ...await importOriginal(),
  loadSkillContent: skillLoader,
}));

// Mock 重依赖让 executor.js 能干净 import（不连 postgres、不 spawn 进程），
// 仅隔离外置正文加载，其余 prompt 组装保持真实。
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

describe('_prepareHarnessReportPrompt — inline SKILL（防 slash command 静默降级）', () => {
  it('harness_report 任务的 prompt 不以 / 开头，且 inline 了 harness-report SKILL 内容', async () => {
    const { preparePrompt } = await import('../executor.js');

    const task = {
      id: 'report-task-1',
      title: 'harness report test',
      description: '生成 harness 交付报告',
      task_type: 'harness_report',
      payload: {
        sprint_dir: 'sprints/test-sprint',
        pr_url: 'https://github.com/x/y/pull/1',
        initiative_id: 'init-1',
      },
    };

    const prompt = await preparePrompt(task);

    // 1) 不能以裸 slash command 开头（容器 headless 不展开 → 空 SKILL 静默降级）
    expect(prompt.startsWith('/')).toBe(false);

    // 2) 完整内联独立 loader 返回的正文，不能回落到裸 slash
    expect(prompt).toContain('NATIVE_REPORT_SKILL_FIXTURE_74b1');

    // 3) 仍保留原有参数块（task_id / sprint_dir / pr_url）
    expect(prompt).toContain('report-task-1');
    expect(prompt).toContain('sprints/test-sprint');
    expect(prompt).toContain('https://github.com/x/y/pull/1');
  });
  it('外置正文加载失败必须传播，不能静默生成降级 prompt', async () => {
    const { preparePrompt } = await import('../executor.js');
    skillLoader.mockImplementationOnce(() => { throw new Error('fixture skill unavailable'); });
    await expect(preparePrompt({ id: 'report-missing', task_type: 'harness_report', payload: { sprint_dir: 'sprints/test-sprint' } })).rejects.toThrow('fixture skill unavailable');
  });
});
