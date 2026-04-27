import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const VALID_PRD = `# Sprint PRD

## 目标
做 X。

## User Stories
US-001: 作为 A，我希望 B。

## 验收场景
场景 1: Given X When Y Then Z

## 功能需求
- FR-001: 做 X

## 成功标准
- SC-001: X 命中率 100%
`;

function makeValidTaskPlan() {
  return {
    tasks: [
      { task_id: 't1', dod: ['d1'], estimated_minutes: 30, depends_on: [] },
      { task_id: 't2', dod: ['d1'], estimated_minutes: 45, depends_on: ['t1'] },
    ],
  };
}

function writeInitiative(dir: string, prd: string, plan: unknown) {
  writeFileSync(join(dir, 'sprint-prd.md'), prd);
  if (plan !== undefined) {
    writeFileSync(join(dir, 'task-plan.json'), JSON.stringify(plan));
  }
}

let validatePreflight: (initiativeDir: string) => Promise<{ verdict: string; failures: string[] }>;

beforeAll(async () => {
  const modPath = '../../../packages/brain/src/preflight.js';
  try {
    const mod = await import(/* @vite-ignore */ modPath);
    validatePreflight = mod.validatePreflight;
    if (typeof validatePreflight !== 'function') {
      throw new Error('validatePreflight is not exported as a function');
    }
  } catch (loadErr) {
    const err = loadErr;
    validatePreflight = async () => {
      throw err;
    };
  }
});

describe('Workstream 1 — validatePreflight [BEHAVIOR]', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'preflight-ws1-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns pass with empty failures for fully compliant initiative', async () => {
    writeInitiative(dir, VALID_PRD, makeValidTaskPlan());
    const result = await validatePreflight(dir);
    expect(result.verdict).toBe('pass');
    expect(result.failures).toEqual([]);
  });

  it('returns fail with prd_empty when sprint-prd.md is empty', async () => {
    writeInitiative(dir, '', makeValidTaskPlan());
    const result = await validatePreflight(dir);
    expect(result.verdict).toBe('fail');
    expect(result.failures).toContain('prd_empty');
  });

  it('returns fail with missing_section code listing the absent section', async () => {
    const prdWithoutSuccess = VALID_PRD.replace(/## 成功标准[\s\S]*$/, '');
    writeInitiative(dir, prdWithoutSuccess, makeValidTaskPlan());
    const result = await validatePreflight(dir);
    expect(result.verdict).toBe('fail');
    expect(result.failures).toContain('missing_section:成功标准');
  });

  it('returns fail with task_plan_missing when task-plan.json absent', async () => {
    writeFileSync(join(dir, 'sprint-prd.md'), VALID_PRD);
    const result = await validatePreflight(dir);
    expect(result.verdict).toBe('fail');
    expect(result.failures).toContain('task_plan_missing');
  });

  it('returns fail with dag_cycle_detected and lists cycle node ids', async () => {
    const cyclic = {
      tasks: [
        { task_id: 't1', dod: ['d'], estimated_minutes: 30, depends_on: ['t2'] },
        { task_id: 't2', dod: ['d'], estimated_minutes: 30, depends_on: ['t1'] },
      ],
    };
    writeInitiative(dir, VALID_PRD, cyclic);
    const result = await validatePreflight(dir);
    expect(result.verdict).toBe('fail');
    const cycleFailure = result.failures.find((f: string) => f.startsWith('dag_cycle_detected'));
    expect(cycleFailure).toBeDefined();
    expect(cycleFailure).toContain('t1');
    expect(cycleFailure).toContain('t2');
  });

  it('returns fail with self_dependency when a task depends on itself', async () => {
    const selfDep = {
      tasks: [{ task_id: 't1', dod: ['d'], estimated_minutes: 30, depends_on: ['t1'] }],
    };
    writeInitiative(dir, VALID_PRD, selfDep);
    const result = await validatePreflight(dir);
    expect(result.verdict).toBe('fail');
    expect(result.failures).toContain('self_dependency:t1');
  });

  it('returns fail with dangling_dependency naming the missing task_id', async () => {
    const dangling = {
      tasks: [{ task_id: 't1', dod: ['d'], estimated_minutes: 30, depends_on: ['ghost'] }],
    };
    writeInitiative(dir, VALID_PRD, dangling);
    const result = await validatePreflight(dir);
    expect(result.verdict).toBe('fail');
    expect(result.failures).toContain('dangling_dependency:ghost');
  });

  it('returns fail with task_count_out_of_range when tasks > 8 or < 1', async () => {
    const empty = { tasks: [] };
    writeInitiative(dir, VALID_PRD, empty);
    const result = await validatePreflight(dir);
    expect(result.verdict).toBe('fail');
    expect(result.failures).toContain('task_count_out_of_range');
  });

  it('returns fail with estimated_minutes_out_of_range for any task outside [20,60]', async () => {
    const tooLong = {
      tasks: [{ task_id: 't1', dod: ['d'], estimated_minutes: 90, depends_on: [] }],
    };
    writeInitiative(dir, VALID_PRD, tooLong);
    const result = await validatePreflight(dir);
    expect(result.verdict).toBe('fail');
    expect(result.failures).toContain('estimated_minutes_out_of_range:t1');
  });

  it('returns fail with empty_dod when any task has zero dod entries', async () => {
    const noDod = {
      tasks: [{ task_id: 't1', dod: [], estimated_minutes: 30, depends_on: [] }],
    };
    writeInitiative(dir, VALID_PRD, noDod);
    const result = await validatePreflight(dir);
    expect(result.verdict).toBe('fail');
    expect(result.failures).toContain('empty_dod:t1');
  });

  it('completes validation in under 200 ms for a typical initiative', async () => {
    writeInitiative(dir, VALID_PRD, makeValidTaskPlan());
    const start = Date.now();
    await validatePreflight(dir);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});
