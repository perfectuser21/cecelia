/**
 * Test: strategist_decision 任务的 skill 路由 + prompt 参数注入
 *
 * PR3674 只完成了任务创建侧（line-strategist-dispatch.js），executor.js 执行侧
 * 完全没接：getSkillForTaskType 的 skillMap 缺 strategist_decision，fallback 成 /dev；
 * _prepareDefaultPrompt 也不会把 payload.journey_id 等塞进 prompt。
 *
 * 修法：skillMap 补项 + 仿 _prepareHarnessReportPrompt 模式新增
 * _prepareStrategistDecisionPrompt（inline SKILL.md + 参数块）。
 *
 * 注意：本测试**不 mock fs**，让 loadSkillContent 读到真实的
 * packages/workflows/skills/line-strategist/SKILL.md（Step 1 已同步）。
 */

import { describe, it, expect, vi } from 'vitest';

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

    // 2) 必须 inline 了真实 line-strategist SKILL.md 的内容特征串
    expect(prompt).toContain('Line 军师(line-strategist)');

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
});
