import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASK_PLAN_PATH = resolve(__dirname, '../../task-plan.json');

type Task = {
  id: string;
  scope: string;
  files: string[];
  dod: string[];
  depends_on: string[];
  complexity: string;
  estimated_minutes: number;
};

type TaskPlan = { tasks: Task[] };

function loadPlan(): TaskPlan {
  if (!existsSync(TASK_PLAN_PATH)) {
    throw new Error(`task-plan.json not found at ${TASK_PLAN_PATH}`);
  }
  const raw = readFileSync(TASK_PLAN_PATH, 'utf8');
  return JSON.parse(raw) as TaskPlan;
}

describe('Workstream 1 — task-plan.json baseline DAG [BEHAVIOR]', () => {
  it('parses sprints/task-plan.json without JSON syntax error', () => {
    expect(existsSync(TASK_PLAN_PATH)).toBe(true);
    const raw = readFileSync(TASK_PLAN_PATH, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('contains exactly 4 tasks at top-level tasks array', () => {
    const plan = loadPlan();
    expect(Array.isArray(plan.tasks)).toBe(true);
    expect(plan.tasks.length).toBe(4);
  });

  it('every task has all required fields: id, scope, files, dod, depends_on, complexity, estimated_minutes', () => {
    const plan = loadPlan();
    const required = ['id', 'scope', 'files', 'dod', 'depends_on', 'complexity', 'estimated_minutes'] as const;
    for (const t of plan.tasks) {
      for (const k of required) {
        expect(Object.prototype.hasOwnProperty.call(t, k)).toBe(true);
      }
    }
  });

  it('every task estimated_minutes is integer between 20 and 60 inclusive', () => {
    const plan = loadPlan();
    for (const t of plan.tasks) {
      expect(Number.isInteger(t.estimated_minutes)).toBe(true);
      expect(t.estimated_minutes).toBeGreaterThanOrEqual(20);
      expect(t.estimated_minutes).toBeLessThanOrEqual(60);
    }
  });

  it('every task files array has at least one entry', () => {
    const plan = loadPlan();
    for (const t of plan.tasks) {
      expect(Array.isArray(t.files)).toBe(true);
      expect(t.files.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every task dod array has at least one entry', () => {
    const plan = loadPlan();
    for (const t of plan.tasks) {
      expect(Array.isArray(t.dod)).toBe(true);
      expect(t.dod.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every task has explicit depends_on array even when empty', () => {
    const plan = loadPlan();
    const raw = readFileSync(TASK_PLAN_PATH, 'utf8');
    const rawObj = JSON.parse(raw) as { tasks: Array<Record<string, unknown>> };
    for (const t of rawObj.tasks) {
      expect(Object.prototype.hasOwnProperty.call(t, 'depends_on')).toBe(true);
      expect(Array.isArray(t.depends_on)).toBe(true);
    }
  });

  it('every task id is unique across the plan', () => {
    const plan = loadPlan();
    const ids = plan.tasks.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });

  it('no task depends on itself', () => {
    const plan = loadPlan();
    for (const t of plan.tasks) {
      expect(t.depends_on.includes(t.id)).toBe(false);
    }
  });

  it('every depends_on id refers to a known task id', () => {
    const plan = loadPlan();
    const ids = new Set(plan.tasks.map((t) => t.id));
    for (const t of plan.tasks) {
      for (const dep of t.depends_on) {
        expect(ids.has(dep)).toBe(true);
      }
    }
  });

  it('DAG is acyclic via Kahn topological sort', () => {
    const plan = loadPlan();
    const indeg = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const t of plan.tasks) {
      indeg.set(t.id, 0);
      adj.set(t.id, []);
    }
    for (const t of plan.tasks) {
      for (const dep of t.depends_on) {
        adj.get(dep)!.push(t.id);
        indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
      }
    }
    const queue: string[] = [];
    for (const [id, d] of indeg) {
      if (d === 0) queue.push(id);
    }
    const order: string[] = [];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      order.push(cur);
      for (const nxt of adj.get(cur) ?? []) {
        const nd = (indeg.get(nxt) ?? 0) - 1;
        indeg.set(nxt, nd);
        if (nd === 0) queue.push(nxt);
      }
    }
    expect(order.length).toBe(plan.tasks.length);
  });

  it('every task has at least one DoD entry prefixed with [BEHAVIOR]', () => {
    const plan = loadPlan();
    for (const t of plan.tasks) {
      const hasBehavior = t.dod.some((d) => d.trim().startsWith('[BEHAVIOR]'));
      expect(hasBehavior).toBe(true);
    }
  });
});
