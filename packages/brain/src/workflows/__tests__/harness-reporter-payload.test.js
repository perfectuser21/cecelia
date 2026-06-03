import { describe, it, expect, vi } from 'vitest';
import { reportNode } from '../harness-initiative.graph.js';

describe('reportNode — harness_report payload 含 gan_rounds / gan_cost_usd', () => {
  let insertedPayload;

  const mockPool = {
    query: vi.fn(async (sql, params) => {
      if (sql && sql.includes('harness_report') && params) {
        insertedPayload = JSON.parse(params[2]);
      }
      if (sql && (sql.includes('SELECT') || sql.includes('task_events'))) return { rows: [] };
      return { rows: [] };
    }),
    connect: vi.fn(async () => ({
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    })),
  };

  const baseState = {
    initiativeId: 'test-init-001',
    task: { title: 'Test Run', payload: {} },
    sub_tasks: [{ id: 'ws1', pr_url: 'https://github.com/test/pr/1', status: 'merged', cost_usd: 0.05 }],
    ganResult: { rounds: 2, cost_usd: 0.12, verdict: 'APPROVED', propose_branch: 'cp-test' },
    sprintDir: 'sprints/test-sprint',
    final_e2e_verdict: 'PASS',
  };

  it('payload 含 gan_rounds = ganResult.rounds', async () => {
    insertedPayload = undefined;
    await reportNode(baseState, { pool: mockPool });
    expect(insertedPayload).toBeDefined();
    expect(insertedPayload.gan_rounds).toBe(2);
  });

  it('payload 含 gan_cost_usd = ganResult.cost_usd', async () => {
    insertedPayload = undefined;
    await reportNode(baseState, { pool: mockPool });
    expect(insertedPayload.gan_cost_usd).toBe(0.12);
  });

  it('ganResult 为 null 时 gan_rounds 默认 0', async () => {
    insertedPayload = undefined;
    await reportNode({ ...baseState, ganResult: null }, { pool: mockPool });
    expect(insertedPayload.gan_rounds).toBe(0);
    expect(insertedPayload.gan_cost_usd).toBe(0);
  });
});
