import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const VALIDATOR_PATH = '../../validators/taskplan-schema.mjs';

const REAL_PLAN = JSON.parse(readFileSync('sprints/task-plan.json', 'utf8'));

function clonePlan() {
  return JSON.parse(JSON.stringify(REAL_PLAN));
}

describe('Workstream 3 — validateTaskPlanSchema [BEHAVIOR]', () => {
  it('[ws3.t1] returns ok=true taskCount=4 with sum of estimated_minutes in [80,300] for the real plan', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const result = mod.validateTaskPlanSchema(REAL_PLAN);
    expect(result.ok).toBe(true);
    expect(result.taskCount).toBe(REAL_PLAN.tasks.length);
    const sum = REAL_PLAN.tasks.reduce((a: number, t: any) => a + t.estimated_minutes, 0);
    expect(sum).toBeGreaterThanOrEqual(80);
    expect(sum).toBeLessThanOrEqual(300);
  });

  it('[ws3.t2] returns ok=false flagging tasks count out of range when plan has 3 tasks', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const plan = clonePlan();
    plan.tasks = plan.tasks.slice(0, 3);
    const result = mod.validateTaskPlanSchema(plan);
    expect(result.ok).toBe(false);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.some((e: any) => /tasks.*count|tasks.*length|count.*range/i.test(JSON.stringify(e)))).toBe(true);
  });

  it('[ws3.t3] returns ok=false flagging complexity field when a task has complexity=X', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const plan = clonePlan();
    plan.tasks[0].complexity = 'X';
    const result = mod.validateTaskPlanSchema(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: any) => /complexity/i.test(JSON.stringify(e)))).toBe(true);
  });

  it('[ws3.t4] returns ok=false flagging estimated_minutes when value is 10 (below floor)', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const plan = clonePlan();
    plan.tasks[0].estimated_minutes = 10;
    const result = mod.validateTaskPlanSchema(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: any) => /estimated_minutes|minutes/i.test(JSON.stringify(e)))).toBe(true);
  });

  it('[ws3.t5] returns ok=false flagging estimated_minutes when value is 75 (above ceiling)', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const plan = clonePlan();
    plan.tasks[0].estimated_minutes = 75;
    const result = mod.validateTaskPlanSchema(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: any) => /estimated_minutes|minutes/i.test(JSON.stringify(e)))).toBe(true);
  });

  it('[ws3.t6] returns ok=false flagging duplicate task_id when two tasks share the same id', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const plan = clonePlan();
    plan.tasks[1].task_id = plan.tasks[0].task_id;
    const result = mod.validateTaskPlanSchema(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: any) => /duplicate|unique|task_id/i.test(JSON.stringify(e)))).toBe(true);
  });
});
