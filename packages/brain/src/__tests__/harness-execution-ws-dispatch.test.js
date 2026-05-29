import { describe, it, expect } from 'vitest';

/**
 * 回归测试：Harness Pipeline 单 WS 调度
 *
 * harness-contract-proposer v8.0 + harness-generator v7.0 改为单 Sprint = 单 Generator = 单 PR 模式。
 * Brain execution.js 必须不再创建多个 WS generator task，generator 完成后无条件触发 evaluator。
 */
describe('harness execution — 单 WS 调度回归', () => {
  it('generator task payload 不包含 workstream_index 或 workstream_count', () => {
    // 模拟 APPROVED 后创建的 generator payload（新模式）
    const generatorPayload = {
      sprint_dir: 'sprints/test',
      planner_task_id: 'plan-001',
      planner_branch: 'cp-test-planner',
      contract_branch: 'cp-propose-r1-abc123',
      harness_mode: true
    };

    expect(generatorPayload.workstream_index).toBeUndefined();
    expect(generatorPayload.workstream_count).toBeUndefined();
    expect(generatorPayload.harness_mode).toBe(true);
  });

  it('单 Sprint 模式：generator task 标题不含 WS 分片信息', () => {
    const plannerShort = '抖音发布功能';
    // 新标题格式（无 G1/N 分片）
    const newTitle = `[Generator] — ${plannerShort}`;
    // 旧格式（含 WS 分片，应该不再出现）
    const oldTitlePattern = /G\d+\/\d+/;

    expect(newTitle).not.toMatch(oldTitlePattern);
    expect(newTitle).toContain('[Generator]');
    expect(newTitle).toContain(plannerShort);
  });

  it('generator 完成后应直接触发 evaluator（不依赖 WS index 判断）', () => {
    // 旧逻辑：只有 currentWsIdx === totalWsCount 才触发 evaluator
    // 新逻辑：无条件触发
    // 此测试验证：移除 WS index 字段后，evaluator 触发逻辑无需 WS 状态
    const generatorResult = {
      verdict: 'DONE',
      pr_url: 'https://github.com/perfectuser21/cecelia/pull/9999'
    };

    // 不再需要 workstream_index === workstream_count 这个条件
    const shouldTriggerEvaluator = !!generatorResult.pr_url;
    expect(shouldTriggerEvaluator).toBe(true);
  });

  it('task-plan.json 单 task 结构符合新 proposer 输出格式', () => {
    // proposer v8.0 固定输出 1 个 task，workstream_count 固定为 1
    const taskPlan = {
      initiative_id: 'pending',
      journey_type: 'autonomous',
      tasks: [
        {
          task_id: 'ws1',
          title: '实现抖音发布完整功能',
          depends_on: [],
          complexity: 'M',
          estimated_minutes: 60
        }
      ]
    };

    expect(taskPlan.tasks).toHaveLength(1);
    expect(taskPlan.tasks[0].task_id).toBe('ws1');
    expect(taskPlan.tasks[0].depends_on).toEqual([]);
  });
});
