/**
 * Planning Engine Tests - Phase 5.2 + 5.3
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API_BASE = 'http://localhost:5211/api/system';

// Response types
interface ApiResponse {
  success: boolean;
  [key: string]: unknown;
}

describe('Planning Engine API', () => {
  describe('POST /api/system/plan/generate', () => {
    it('should generate a daily plan', async () => {
      const response = await fetch(`${API_BASE}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'daily' }),
      });

      const data = (await response.json()) as ApiResponse;
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);

      const plan = data.plan as {
        plan_id: string;
        scope: string;
        tasks: unknown[];
        summary: { total: number };
        reasoning: string;
      };
      expect(plan.plan_id).toMatch(/^plan_daily_\d{8}$/);
      expect(plan.scope).toBe('daily');
      expect(Array.isArray(plan.tasks)).toBe(true);
      expect(plan.summary.total).toBeGreaterThanOrEqual(0);
      expect(plan.reasoning).toBeDefined();
    });

    it('should generate a weekly plan', async () => {
      const response = await fetch(`${API_BASE}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'weekly' }),
      });

      const data = (await response.json()) as ApiResponse;
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);

      const plan = data.plan as { plan_id: string; scope: string };
      expect(plan.plan_id).toMatch(/^plan_weekly_\d{8}$/);
      expect(plan.scope).toBe('weekly');
    });

    it('should reject invalid scope', async () => {
      const response = await fetch(`${API_BASE}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'invalid' }),
      });

      const data = (await response.json()) as ApiResponse;
      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('should default to daily scope if not provided', async () => {
      const response = await fetch(`${API_BASE}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = (await response.json()) as ApiResponse;
      expect(response.status).toBe(201);
      expect((data.plan as { scope: string }).scope).toBe('daily');
    });
  });

  describe('GET /api/system/plan/status', () => {
    beforeAll(async () => {
      // Ensure a plan exists
      await fetch(`${API_BASE}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'daily' }),
      });
    });

    it('should return current plan status', async () => {
      const response = await fetch(`${API_BASE}/plan/status`);
      const data = (await response.json()) as ApiResponse;

      expect(data.success).toBe(true);
      expect(data.active_plan).toBeDefined();
      expect(data.progress).toBeDefined();

      const progress = data.progress as {
        total: number;
        completed: number;
        in_progress: number;
        pending: number;
      };
      expect(typeof progress.total).toBe('number');
      expect(typeof progress.completed).toBe('number');
      expect(typeof progress.in_progress).toBe('number');
      expect(typeof progress.pending).toBe('number');
    });

    it('should include next_task if available', async () => {
      const response = await fetch(`${API_BASE}/plan/status`);
      const data = (await response.json()) as ApiResponse;

      expect(data.success).toBe(true);
      // next_task can be null if no tasks
      if (data.next_task) {
        const nextTask = data.next_task as { id: string; title: string; priority: string };
        expect(nextTask.id).toBeDefined();
        expect(nextTask.title).toBeDefined();
        expect(nextTask.priority).toBeDefined();
      }
    });
  });

  describe('GET /api/system/plan/:planId', () => {
    let planId: string;

    beforeAll(async () => {
      // Generate a plan to get its ID
      const response = await fetch(`${API_BASE}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'daily' }),
      });
      const data = (await response.json()) as ApiResponse;
      planId = (data.plan as { plan_id: string }).plan_id;
    });

    it('should return plan by ID', async () => {
      const response = await fetch(`${API_BASE}/plan/${planId}`);
      const data = (await response.json()) as ApiResponse;

      expect(data.success).toBe(true);
      expect((data.plan as { plan_id: string }).plan_id).toBe(planId);
    });

    it('should return 404 for non-existent plan', async () => {
      const response = await fetch(`${API_BASE}/plan/plan_nonexistent_99999999`);
      expect(response.status).toBe(404);
    });
  });

  describe('Plan stored in Memory', () => {
    it('should store plan in working memory', async () => {
      // Generate a plan
      await fetch(`${API_BASE}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'daily' }),
      });

      // Check memory for plan
      const memoryResponse = await fetch(`${API_BASE}/memory?layer=working&category=state`);
      const memoryData = (await memoryResponse.json()) as ApiResponse;

      expect(memoryData.success).toBe(true);
      const entries = memoryData.entries as Array<{ key: string; layer: string; category: string }>;
      const planEntry = entries.find(e => e.key.startsWith('plan_daily_'));
      expect(planEntry).toBeDefined();
      expect(planEntry?.layer).toBe('working');
      expect(planEntry?.category).toBe('state');
    });

    it('should store current_plan reference in context', async () => {
      // Generate a plan
      await fetch(`${API_BASE}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'daily' }),
      });

      // Check memory for current_plan
      const memoryResponse = await fetch(`${API_BASE}/memory/current_plan`);
      const memoryData = (await memoryResponse.json()) as ApiResponse;

      expect(memoryData.success).toBe(true);
      const entry = memoryData.entry as { layer: string; category: string; value: { plan_id: string } };
      expect(entry.layer).toBe('working');
      expect(entry.category).toBe('context');
      expect(entry.value.plan_id).toMatch(/^plan_\w+_\d{8}$/);
    });
  });

  describe('Plan tasks sorted by priority', () => {
    it('should prioritize P0 tasks over P1 and P2', async () => {
      const response = await fetch(`${API_BASE}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'daily' }),
      });

      const data = (await response.json()) as ApiResponse;
      const plan = data.plan as { tasks: Array<{ priority: string }> };

      if (plan.tasks.length > 1) {
        // Check that P0 tasks come before P1 tasks
        let foundP1 = false;
        for (const task of plan.tasks) {
          if (task.priority === 'P1') foundP1 = true;
          if (task.priority === 'P0' && foundP1) {
            // P0 after P1 means wrong order
            expect(true).toBe(false);
          }
        }
      }
      // If only 0 or 1 task, ordering is trivially correct
      expect(true).toBe(true);
    });
  });

  // Phase 5.3: Task structure with why/expected_evidence/source_refs
  describe('Plan tasks have why/expected_evidence/source_refs (Phase 5.3)', () => {
    it('should include why field in each task', async () => {
      const response = await fetch(`${API_BASE}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'daily' }),
      });

      const data = (await response.json()) as ApiResponse;
      const plan = data.plan as { tasks: Array<{ why: string }> };

      // Each task should have a why field
      for (const task of plan.tasks) {
        expect(task.why).toBeDefined();
        expect(typeof task.why).toBe('string');
        expect(task.why.length).toBeGreaterThan(0);
      }
    });

    it('should include expected_evidence field in each task', async () => {
      const response = await fetch(`${API_BASE}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'daily' }),
      });

      const data = (await response.json()) as ApiResponse;
      const plan = data.plan as { tasks: Array<{ expected_evidence: string }> };

      for (const task of plan.tasks) {
        expect(task.expected_evidence).toBeDefined();
        expect(typeof task.expected_evidence).toBe('string');
      }
    });

    it('should include source_refs array in each task', async () => {
      const response = await fetch(`${API_BASE}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'daily' }),
      });

      const data = (await response.json()) as ApiResponse;
      const plan = data.plan as { tasks: Array<{ source_refs: Array<{ type: string; id: string }> }> };

      for (const task of plan.tasks) {
        expect(task.source_refs).toBeDefined();
        expect(Array.isArray(task.source_refs)).toBe(true);
      }
    });
  });

  // Phase 5.3: Plan commit endpoint
  describe('POST /api/system/plan/:planId/commit (Phase 5.3)', () => {
    let planId: string;

    beforeAll(async () => {
      // Generate a plan first
      const response = await fetch(`${API_BASE}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'daily' }),
      });
      const data = (await response.json()) as ApiResponse;
      planId = (data.plan as { plan_id: string }).plan_id;
    });

    it('should commit plan tasks to database', async () => {
      const response = await fetch(`${API_BASE}/plan/${planId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 3 }),
      });

      const data = (await response.json()) as ApiResponse;

      // Even if no tasks, the response structure should be correct
      expect(data.plan_id).toBe(planId);
      expect(Array.isArray(data.committed_tasks)).toBe(true);
    });

    it('should return 404 for non-existent plan', async () => {
      const response = await fetch(`${API_BASE}/plan/plan_nonexistent_99999999/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 3 }),
      });

      expect(response.status).toBe(404);
    });

    it('should respect limit parameter', async () => {
      // Generate fresh plan
      const genResponse = await fetch(`${API_BASE}/plan/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'daily' }),
      });
      const genData = (await genResponse.json()) as ApiResponse;
      const newPlanId = (genData.plan as { plan_id: string }).plan_id;

      const response = await fetch(`${API_BASE}/plan/${newPlanId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 1 }),
      });

      const data = (await response.json()) as ApiResponse;
      const committed = data.committed_tasks as Array<{ task_id: string }>;

      // Should commit at most 1 task
      expect(committed.length).toBeLessThanOrEqual(1);
    });
  });

  // Phase 5.4: Nightly Planner
  describe('POST /api/system/plan/nightly (Phase 5.4)', () => {
    it('should generate plan and auto-commit tasks', async () => {
      const response = await fetch(`${API_BASE}/plan/nightly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = (await response.json()) as ApiResponse;
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.plan_id).toMatch(/^plan_daily_\d{8}$/);
      expect(typeof data.committed_count).toBe('number');
      expect(typeof data.summary).toBe('string');
      expect(data.next_review).toBeDefined();
    });

    it('should record nightly plan event in memory', async () => {
      // Run nightly planner
      const nightlyResponse = await fetch(`${API_BASE}/plan/nightly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const nightlyData = (await nightlyResponse.json()) as ApiResponse;
      const planId = nightlyData.plan_id as string;

      // Check memory for nightly_plan event
      const memoryResponse = await fetch(`${API_BASE}/memory?layer=episodic&category=event`);
      const memoryData = (await memoryResponse.json()) as ApiResponse;

      expect(memoryData.success).toBe(true);
      const entries = memoryData.entries as Array<{ key: string; value: { type: string; plan_id: string } }>;
      const nightlyEntry = entries.find(e => e.key === `nightly_plan_${planId}`);
      expect(nightlyEntry).toBeDefined();
      expect(nightlyEntry?.value.type).toBe('nightly_plan');
      expect(nightlyEntry?.value.plan_id).toBe(planId);
    });
  });
});
