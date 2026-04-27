import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const VALIDATOR_PATH = '../../validators/taskplan-dag.mjs';

const REAL_PLAN = JSON.parse(readFileSync('sprints/task-plan.json', 'utf8'));

function clonePlan() {
  return JSON.parse(JSON.stringify(REAL_PLAN));
}

describe('Workstream 4 — validateTaskPlanDag [BEHAVIOR]', () => {
  it('returns ok=true with entryCount=1 and full topoOrder for the real linear plan', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const result = mod.validateTaskPlanDag(REAL_PLAN);
    expect(result.ok).toBe(true);
    expect(result.entryCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result.topoOrder)).toBe(true);
    expect(result.topoOrder).toHaveLength(REAL_PLAN.tasks.length);
  });

  it('detects self-reference when ws1.depends_on includes "ws1"', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const plan = clonePlan();
    plan.tasks[0].depends_on = [plan.tasks[0].task_id];
    const result = mod.validateTaskPlanDag(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: any) => e.type === 'self-reference' && e.task_id === plan.tasks[0].task_id)).toBe(true);
  });

  it('detects a cycle when ws1->ws2->ws1', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const plan = clonePlan();
    const a = plan.tasks[0].task_id;
    const b = plan.tasks[1].task_id;
    plan.tasks[0].depends_on = [b];
    plan.tasks[1].depends_on = [a];
    const result = mod.validateTaskPlanDag(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: any) => e.type === 'cycle')).toBe(true);
  });

  it('detects a dangling reference when ws3.depends_on includes a non-existent id', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const plan = clonePlan();
    plan.tasks[2].depends_on = ['ws_does_not_exist'];
    const result = mod.validateTaskPlanDag(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: any) => e.type === 'dangling' && e.missing === 'ws_does_not_exist')).toBe(true);
  });

  it('returns ok=false with no-entry when every task has a non-empty depends_on', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const plan = clonePlan();
    const ids = plan.tasks.map((t: any) => t.task_id);
    plan.tasks[0].depends_on = [ids[1]];
    plan.tasks[1].depends_on = [ids[2]];
    plan.tasks[2].depends_on = [ids[3]];
    plan.tasks[3].depends_on = [ids[0]];
    const result = mod.validateTaskPlanDag(plan);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: any) => e.type === 'no-entry')).toBe(true);
  });

  it('topoOrder length equals tasks length, proving the graph is connected from the entry', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const result = mod.validateTaskPlanDag(REAL_PLAN);
    expect(result.ok).toBe(true);
    expect(result.topoOrder.length).toBe(REAL_PLAN.tasks.length);
    const idsInOrder = new Set(result.topoOrder);
    for (const t of REAL_PLAN.tasks) {
      expect(idsInOrder.has(t.task_id)).toBe(true);
    }
  });
});
