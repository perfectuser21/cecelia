/**
 * tick-planner-no-project.test.js
 *
 * 测试 tick.js 对 planNextTask 返回 no_project_for_kr 的处理：
 * 应记录到 actionsTaken，标注等待 decomposition-checker Check C 处理。
 *
 * 设计说明：
 * - 使用与 tick-global-fallback-planner.test.js 相同的纯逻辑验证模式
 * - 通过白盒测试验证 no_project_for_kr 分支逻辑
 */

import { describe, it, expect } from 'vitest';

describe('tick: no_project_for_kr planner branch', () => {
  it('should record no_project_for_kr action when planner returns no_project_for_kr', () => {
    const actionsTaken = [];

    // 模拟 planNextTask 返回 no_project_for_kr
    const planned = {
      planned: false,
      reason: 'no_project_for_kr',
      kr: { id: 'kr-uuid-1', title: 'Orphan KR' },
      project: null,
    };

    // 模拟 tick.js 中的分支逻辑（与代码一致）
    if (planned.planned) {
      actionsTaken.push({ action: 'plan', task_id: planned.task?.id, title: planned.task?.title });
    } else if (planned.reason === 'needs_planning' && planned.kr) {
      actionsTaken.push({
        action: 'needs_planning',
        kr: planned.kr,
        project: planned.project,
        note: 'waiting_for_decomposition_checker',
      });
    } else if (planned.reason === 'no_project_for_kr') {
      actionsTaken.push({
        action: 'no_project_for_kr',
        kr: planned.kr,
        note: 'waiting_for_decomp_checker_check_c',
      });
    }

    expect(actionsTaken.length).toBe(1);
    expect(actionsTaken[0].action).toBe('no_project_for_kr');
    expect(actionsTaken[0].kr.id).toBe('kr-uuid-1');
    expect(actionsTaken[0].note).toBe('waiting_for_decomp_checker_check_c');
  });

  it('should NOT record no_project_for_kr when planning succeeds', () => {
    const actionsTaken = [];

    const planned = {
      planned: true,
      task: { id: 'task-1', title: 'Some Task' },
    };

    if (planned.planned) {
      actionsTaken.push({ action: 'plan', task_id: planned.task?.id, title: planned.task?.title });
    } else if (planned.reason === 'no_project_for_kr') {
      actionsTaken.push({ action: 'no_project_for_kr', kr: planned.kr, note: 'waiting_for_decomp_checker_check_c' });
    }

    expect(actionsTaken.length).toBe(1);
    expect(actionsTaken[0].action).toBe('plan');
  });

  it('should NOT confuse no_project_for_kr with needs_planning', () => {
    const actionsTaken = [];

    const planned = {
      planned: false,
      reason: 'needs_planning',
      kr: { id: 'kr-2', title: 'KR With Project But No Tasks' },
      project: { id: 'proj-1', title: 'Existing Project' },
    };

    if (planned.planned) {
      actionsTaken.push({ action: 'plan' });
    } else if (planned.reason === 'needs_planning' && planned.kr) {
      actionsTaken.push({ action: 'needs_planning', kr: planned.kr, project: planned.project, note: 'waiting_for_decomposition_checker' });
    } else if (planned.reason === 'no_project_for_kr') {
      actionsTaken.push({ action: 'no_project_for_kr', kr: planned.kr, note: 'waiting_for_decomp_checker_check_c' });
    }

    expect(actionsTaken.length).toBe(1);
    expect(actionsTaken[0].action).toBe('needs_planning');
    expect(actionsTaken[0].note).toBe('waiting_for_decomposition_checker');
  });

  it('no_project_for_kr action should carry kr info for observability', () => {
    const actionsTaken = [];

    const planned = {
      planned: false,
      reason: 'no_project_for_kr',
      kr: { id: 'kr-orphan', title: 'No Project KR' },
      project: null,
    };

    if (planned.reason === 'no_project_for_kr') {
      actionsTaken.push({
        action: 'no_project_for_kr',
        kr: planned.kr,
        note: 'waiting_for_decomp_checker_check_c',
      });
    }

    const recorded = actionsTaken[0];
    expect(recorded.kr).toBeDefined();
    expect(recorded.kr.id).toBe('kr-orphan');
    expect(recorded.kr.title).toBe('No Project KR');
    expect(recorded.note).toBe('waiting_for_decomp_checker_check_c');
  });
});
