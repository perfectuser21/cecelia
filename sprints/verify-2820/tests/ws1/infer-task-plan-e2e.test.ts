// @ts-nocheck
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { inferTaskPlanNode } from '../../../../packages/brain/src/workflows/harness-initiative.graph.js';
import { parseTaskPlan } from '../../../../packages/brain/src/harness-dag.js';

const REPO_ROOT = resolve(__dirname, '../../../..');
const SPRINT_DIR_REL = 'sprints/verify-2820';
const TASK_PLAN_PATH = join(REPO_ROOT, SPRINT_DIR_REL, 'task-plan.json');
const SPRINT_PRD_PATH = join(REPO_ROOT, SPRINT_DIR_REL, 'sprint-prd.md');

describe('Workstream 1 — inferTaskPlanNode end-to-end [BEHAVIOR]', () => {
  describe('repo artifacts (real proposer output)', () => {
    it('sprint-prd.md 存在且含 journey_type 合法枚举', () => {
      expect(existsSync(SPRINT_PRD_PATH)).toBe(true);
      const prd = readFileSync(SPRINT_PRD_PATH, 'utf8');
      expect(prd).toMatch(/^## journey_type:\s*(autonomous|user_facing|dev_pipeline|agent_remote)\s*$/m);
    });

    it('task-plan.json 存在且 parseTaskPlan 完整通过 schema 校验', () => {
      expect(existsSync(TASK_PLAN_PATH)).toBe(true);
      const raw = readFileSync(TASK_PLAN_PATH, 'utf8');
      const plan = parseTaskPlan(raw);
      expect(plan).toBeDefined();
      expect(Array.isArray(plan.tasks)).toBe(true);
      expect(plan.tasks.length).toBeGreaterThanOrEqual(1);
      for (const t of plan.tasks) {
        expect(typeof t.task_id).toBe('string');
        expect(typeof t.title).toBe('string');
        expect(typeof t.scope).toBe('string');
        expect(Array.isArray(t.dod)).toBe(true);
        expect(t.dod.length).toBeGreaterThanOrEqual(1);
        expect(['S', 'M', 'L']).toContain(t.complexity);
        expect(t.estimated_minutes).toBeGreaterThanOrEqual(20);
        expect(t.estimated_minutes).toBeLessThanOrEqual(60);
      }
    });
  });

  describe('inferTaskPlanNode 单元行为（防回归）', () => {
    let tmpRepo: string;
    const proposeBranch = 'cp-harness-propose-r1-fixture';

    beforeAll(() => {
      tmpRepo = mkdtempSync(join(tmpdir(), 'infer-task-plan-e2e-'));
      execSync('git init -q -b main', { cwd: tmpRepo });
      execSync('git config user.email "test@example.com"', { cwd: tmpRepo });
      execSync('git config user.name "Test"', { cwd: tmpRepo });
      writeFileSync(join(tmpRepo, 'README.md'), 'init');
      execSync('git add . && git commit -q -m init', { cwd: tmpRepo });
      execSync(`git checkout -q -b ${proposeBranch}`, { cwd: tmpRepo });
      mkdirSync(join(tmpRepo, SPRINT_DIR_REL), { recursive: true });

      const validPlan = {
        initiative_id: 'c5d80a6f-5ee4-4044-b031-ebcffaac61ce',
        tasks: [
          {
            task_id: 'ws1',
            title: 'verify task-plan.json end-to-end',
            scope: 'fixture-only sanity for inferTaskPlanNode',
            dod: ['[ARTIFACT] sprints/verify-2820/task-plan.json exists'],
            files: ['sprints/verify-2820/task-plan.json'],
            depends_on: [],
            complexity: 'S',
            estimated_minutes: 30,
          },
        ],
      };
      writeFileSync(
        join(tmpRepo, SPRINT_DIR_REL, 'task-plan.json'),
        JSON.stringify(validPlan, null, 2),
      );
      execSync('git add . && git commit -q -m propose', { cwd: tmpRepo });
      execSync(`git update-ref refs/remotes/origin/${proposeBranch} ${proposeBranch}`, { cwd: tmpRepo });
    });

    afterAll(() => {
      if (tmpRepo) rmSync(tmpRepo, { recursive: true, force: true });
    });

    it('合法 propose 分支：返回 { taskPlan }，不含 error', async () => {
      const state = {
        ganResult: { propose_branch: proposeBranch },
        task: { payload: { sprint_dir: SPRINT_DIR_REL } },
        worktreePath: tmpRepo,
        initiativeId: 'c5d80a6f-5ee4-4044-b031-ebcffaac61ce',
      };
      const delta = await inferTaskPlanNode(state);
      expect(delta.error).toBeUndefined();
      expect(delta.taskPlan).toBeDefined();
      expect(Array.isArray(delta.taskPlan.tasks)).toBe(true);
      expect(delta.taskPlan.tasks.length).toBeGreaterThanOrEqual(1);
    });

    it('propose 分支不存在 task-plan.json：返回 { error } 且字符串含 "task-plan.json failed"', async () => {
      const state = {
        ganResult: { propose_branch: 'cp-harness-propose-r1-MISSING-BRANCH-xyz' },
        task: { payload: { sprint_dir: SPRINT_DIR_REL } },
        worktreePath: tmpRepo,
        initiativeId: 'c5d80a6f-5ee4-4044-b031-ebcffaac61ce',
      };
      const delta = await inferTaskPlanNode(state);
      expect(delta.error).toBeDefined();
      expect(typeof delta.error).toBe('string');
      expect(delta.error).toMatch(/task-plan\.json failed/);
      expect(delta.taskPlan).toBeUndefined();
    });
  });
});
