/**
 * Task 6: parsePrdNode review_required 提取测试
 * 验证 parsePrdNode 能从 plannerOutput 中正确提取 review_required 字段
 */
import { describe, it, expect } from 'vitest';
import { parsePrdNode } from '../harness-initiative.graph.js';

describe('parsePrdNode — review_required 提取', () => {
  it('plannerOutput 含 review_required: true → returns review_required=true', async () => {
    const plannerOutput = JSON.stringify({
      verdict: 'DONE',
      branch: 'cp-test',
      sprint_dir: 'sprints/0628-test',
      planner_branch: 'cp-test',
      review_required: true,
    });
    const result = await parsePrdNode(
      { plannerOutput, task: { id: 'task-1', payload: {} } },
      { db: null }
    );
    expect(result.review_required).toBe(true);
  });

  it('plannerOutput 含 review_required: false → returns review_required=false', async () => {
    const plannerOutput = JSON.stringify({
      verdict: 'DONE',
      branch: 'cp-test',
      sprint_dir: 'sprints/0628-test',
      planner_branch: 'cp-test',
      review_required: false,
    });
    const result = await parsePrdNode(
      { plannerOutput, task: { id: 'task-1', payload: {} } },
      { db: null }
    );
    expect(result.review_required).toBe(false);
  });

  it('plannerOutput 不含 review_required → 向后兼容 fallback 为 false', async () => {
    const plannerOutput = JSON.stringify({
      verdict: 'DONE',
      branch: 'cp-test',
      sprint_dir: 'sprints/0628-test',
      planner_branch: 'cp-test',
    });
    const result = await parsePrdNode(
      { plannerOutput, task: { id: 'task-1', payload: {} } },
      { db: null }
    );
    expect(result.review_required).toBe(false);
  });
});
