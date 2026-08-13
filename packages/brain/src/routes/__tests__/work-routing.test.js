import { describe, expect, it, vi } from 'vitest';

import { validateWorkRoutingIdentity } from '../work-routing.js';

const INPUT = Object.freeze({
  routing_receipt_id: '11111111-1111-4111-8111-111111111111',
  task_id: '22222222-2222-4222-8222-222222222222',
  run_id: '33333333-3333-4333-8333-333333333333',
  repo: 'cecelia',
  branch: 'cp-attempt-workspace',
  base_sha: 'a'.repeat(40),
});

describe('validateWorkRoutingIdentity', () => {
  it('authorizes only a canonical receipt/task projection and the active Attempt workspace', async () => {
    const query = vi.fn(async () => ({ rows: [{
      id: INPUT.routing_receipt_id,
      expires_at: '2026-08-13T10:00:00.000Z',
      superseded: false,
      active_attempt: true,
    }] }));

    await expect(validateWorkRoutingIdentity({ query }, INPUT)).resolves.toEqual({
      status: 200,
      body: {
        valid: true,
        routing_receipt_id: INPUT.routing_receipt_id,
        expires_at: '2026-08-13T10:00:00.000Z',
      },
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("task.payload->>'routing_receipt_id' = receipt.id::text");
    expect(sql).toContain("task.payload->>'harness_runtime' = 'kernel-v1'");
    expect(sql).toContain("receipt.canonical_task_type = 'harness_initiative'");
    expect(sql).toContain("receipt.orchestrator = 'kernel-harness-v2'");
    expect(sql).toContain("attempt.task_bundle->'inputs'->'workspace_spec'->>'branch' = $5");
    expect(sql).toContain("attempt.task_bundle->'inputs'->'workspace_spec'->>'base_sha' = $6");
    expect(params).toEqual([
      INPUT.routing_receipt_id,
      INPUT.task_id,
      INPUT.repo,
      INPUT.run_id,
      INPUT.branch,
      INPUT.base_sha,
    ]);
  });

  it('fails closed before querying when the action identity is malformed', async () => {
    const query = vi.fn();
    await expect(validateWorkRoutingIdentity({ query }, { ...INPUT, base_sha: 'main' }))
      .resolves.toEqual({ status: 400, body: { valid: false, reason_code: 'route_violation' } });
    expect(query).not.toHaveBeenCalled();
  });
});
