/**
 * Test: _prepareHarnessReportPrompt 必须 inline SKILL 内容，不能用裸 slash command
 *
 * Bug B（Bug 7 复刻）：容器内 headless `claude -p` 不展开 slash command。
 * report agent 收到字面量 `/harness-report` + 参数、零 SKILL 指令 → 空壳报告 exit 0 静默降级。
 * 其余 5 个阶段早已改成 inline loadSkillContent，只剩 report 漏网。
 *
 * 修法：和其他阶段对齐，用 loadSkillContent('harness-report') 把 SKILL 内容 inline 进 prompt。
 *
 * 注意：本测试**不 mock fs**，让 loadSkillContent 读到真实的
 * packages/workflows/skills/harness-report/SKILL.md（CI fallback 路径，仓库内已同步）。
 */

import { describe, it, expect, vi } from 'vitest';

// Mock 重依赖让 executor.js 能干净 import（不连 postgres、不 spawn 进程），
// 但**不 mock fs**，loadSkillContent 必须读到真实 SKILL.md。
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

    // 2) 必须 inline 了真实 harness-report SKILL.md 的内容特征串
    expect(prompt).toContain('Phase A: 6步交付报告');

    // 3) 仍保留原有参数块（task_id / sprint_dir / pr_url）
    expect(prompt).toContain('report-task-1');
    expect(prompt).toContain('sprints/test-sprint');
    expect(prompt).toContain('https://github.com/x/y/pull/1');
  });
});
