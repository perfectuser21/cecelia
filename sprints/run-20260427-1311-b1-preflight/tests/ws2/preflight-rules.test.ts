import { describe, it, expect } from 'vitest';

const MODULE_PATH = '../../../../packages/brain/src/preflight-rules.js';

async function loadRunPreflight(): Promise<
  (input: { description: string; prd: string; taskPlan: any }) => Promise<{
    status: string;
    reasons: string[];
  }>
> {
  const mod = (await import(MODULE_PATH)) as any;
  if (typeof mod.runPreflight !== 'function') {
    throw new Error('runPreflight not exported from preflight-rules.js');
  }
  return mod.runPreflight;
}

const COMPLIANT_DESCRIPTION =
  '本 Initiative 实现 Initiative 级 pre-flight check 流水线最小闭环，覆盖 PRD 字段、task-plan schema、DAG 校验，并在派发 Generator 前拦截不合规请求。';

const COMPLIANT_PRD = `# Sprint PRD
## OKR 对齐
KR-foo
## 背景
bg
## 目标
goal
## User Stories
US-001 ...
## 验收场景
GWT
## 功能需求
FR-001
## 成功标准
SC-001 端到端通过
## 假设
none
## 边界情况
edge
## 范围限定
in
## 预期受影响文件
files
`;

const COMPLIANT_TASK_PLAN = {
  initiative_id: 'init-1',
  tasks: [
    { task_id: 'a', title: 't1', estimated_minutes: 30, depends_on: [] },
    { task_id: 'b', title: 't2', estimated_minutes: 40, depends_on: ['a'] },
    { task_id: 'c', title: 't3', estimated_minutes: 50, depends_on: ['b'] },
  ],
};

describe('Workstream 2 — preflight rules module [BEHAVIOR]', () => {
  it('returns passed with empty reasons for a fully compliant initiative', async () => {
    const runPreflight = await loadRunPreflight();
    const result = await runPreflight({
      description: COMPLIANT_DESCRIPTION,
      prd: COMPLIANT_PRD,
      taskPlan: COMPLIANT_TASK_PLAN,
    });
    expect(result.status).toBe('passed');
    expect(Array.isArray(result.reasons)).toBe(true);
    expect(result.reasons.length).toBe(0);
  });

  it('returns rejected with dag_has_cycle reason when task-plan contains a 2-task cycle', async () => {
    const runPreflight = await loadRunPreflight();
    const cyclic = {
      ...COMPLIANT_TASK_PLAN,
      tasks: [
        { task_id: 'a', title: 't1', estimated_minutes: 30, depends_on: ['b'] },
        { task_id: 'b', title: 't2', estimated_minutes: 30, depends_on: ['a'] },
      ],
    };
    const result = await runPreflight({
      description: COMPLIANT_DESCRIPTION,
      prd: COMPLIANT_PRD,
      taskPlan: cyclic,
    });
    expect(result.status).toBe('rejected');
    expect(result.reasons.some((r: string) => r.startsWith('dag_has_cycle'))).toBe(true);
  });

  it('returns rejected with prd_missing_section: success_criteria when PRD lacks the section', async () => {
    const runPreflight = await loadRunPreflight();
    const prdMissing = COMPLIANT_PRD.replace(/## 成功标准[\s\S]*?(?=##\s|$)/, '');
    const result = await runPreflight({
      description: COMPLIANT_DESCRIPTION,
      prd: prdMissing,
      taskPlan: COMPLIANT_TASK_PLAN,
    });
    expect(result.status).toBe('rejected');
    expect(result.reasons).toContain('prd_missing_section: success_criteria');
  });

  it('returns rejected with task_count_exceeded when task-plan has more than 8 tasks', async () => {
    const runPreflight = await loadRunPreflight();
    const many = {
      ...COMPLIANT_TASK_PLAN,
      tasks: Array.from({ length: 9 }, (_, i) => ({
        task_id: `t${i}`,
        title: `task ${i}`,
        estimated_minutes: 30,
        depends_on: [],
      })),
    };
    const result = await runPreflight({
      description: COMPLIANT_DESCRIPTION,
      prd: COMPLIANT_PRD,
      taskPlan: many,
    });
    expect(result.status).toBe('rejected');
    expect(result.reasons).toContain('task_count_exceeded');
  });

  it('returns rejected with description_too_short when description is below 50 characters', async () => {
    const runPreflight = await loadRunPreflight();
    const result = await runPreflight({
      description: 'short',
      prd: COMPLIANT_PRD,
      taskPlan: COMPLIANT_TASK_PLAN,
    });
    expect(result.status).toBe('rejected');
    expect(result.reasons).toContain('description_too_short');
  });

  it('returns rejected with task_missing_field reason when a task lacks estimated_minutes', async () => {
    const runPreflight = await loadRunPreflight();
    const broken = {
      ...COMPLIANT_TASK_PLAN,
      tasks: [
        { task_id: 'a', title: 't1', depends_on: [] },
        { task_id: 'b', title: 't2', estimated_minutes: 30, depends_on: ['a'] },
      ],
    };
    const result = await runPreflight({
      description: COMPLIANT_DESCRIPTION,
      prd: COMPLIANT_PRD,
      taskPlan: broken,
    });
    expect(result.status).toBe('rejected');
    expect(
      result.reasons.some((r: string) => r.startsWith('task_missing_field: estimated_minutes')),
    ).toBe(true);
  });
});
