import { describe, expect, it, vi } from 'vitest';
import { reanchorReceiptIfEmptyBranch, MAX_FASTFORWARD } from './base-sha-reanchor.js';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RECEIPT_ID = '22222222-2222-4222-8222-222222222222';
const NEXT_ID = '33333333-3333-4333-8333-333333333333';

function baseReceipt(overrides = {}) {
  return {
    id: RECEIPT_ID, task_id: TASK_ID, source: 'api', source_id: 'route-1',
    work_kind: 'coding_mutation', change_kind: 'bugfix', pipeline: 'harness',
    canonical_task_type: 'harness_initiative', default_execution_profile: 'hotfix-v1',
    execution_profile_override: null, repo: 'cecelia', map_scope: ['F1'],
    impact_contract_required: true, orchestrator: 'skill-relay', router_version: 'v2',
    route_reason: 'coding', evidence: { branch: 'cp-route-api-1', base_sha: OLD },
    map_scope_validation_version: 'active-business-node-v1', direct_contract_seed: null,
    anchor_generation: 1, has_v2_run: false, superseded: false,
    ...overrides,
  };
}
function freshMap(revision = NEW) {
  return {
    projection_run_id: '44444444-4444-4444-8444-444444444444',
    freshness: { status: 'fresh', repos: { cecelia: { status: 'fresh', source_revision: revision } } },
  };
}
function mockClient({ hasAnyRun = false } = {}) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/AS has_any_run/.test(sql)) return { rows: [{ has_any_run: hasAnyRun }] };
      if (/INSERT INTO work_routing_receipts/.test(sql)) {
        return { rows: [{ ...baseReceipt(), id: NEXT_ID, anchor_generation: params[19], supersedes_receipt_id: params[18], evidence: JSON.parse(params[15]) }] };
      }
      if (/UPDATE tasks/.test(sql)) return { rows: [], rowCount: 1 };
      if (/INSERT INTO cecelia_events/.test(sql)) return { rows: [], rowCount: 1 };
      if (/INSERT INTO task_events/.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
  return { client, calls };
}
const task = { id: TASK_ID, payload: {}, metadata: {} };

describe('reanchorReceiptIfEmptyBranch', () => {
  it('无产出 + 地图前进 → 插接班收据、同步 payload、留痕，返回新收据', async () => {
    const { client, calls } = mockClient();
    const result = await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: freshMap(), now: new Date('2026-09-23T09:00:00Z') });
    expect(result.id).toBe(NEXT_ID);
    expect(result.anchor_generation).toBe(2);
    expect(result.evidence).toMatchObject({ base_sha: NEW, prev_base_sha: OLD, reanchor_reason: 'map_revision_advanced' });
    expect(result.has_v2_run).toBe(false);
    const insert = calls.find((c) => /INSERT INTO work_routing_receipts/.test(c.sql));
    expect(insert.params[18]).toBe(RECEIPT_ID); // supersedes_receipt_id
    expect(insert.params[19]).toBe(2);           // anchor_generation
    const update = calls.find((c) => /UPDATE tasks/.test(c.sql));
    expect(JSON.parse(update.params[1])).toMatchObject({ routing_receipt_id: NEXT_ID, base_sha: NEW });
    expect(JSON.parse(update.params[2])).toMatchObject({ base_sha_fastforward_count: 1 });
    // 顺序：先 INSERT 收据，后 UPDATE tasks（421 触发器按最新收据比对）
    expect(calls.findIndex((c) => /INSERT INTO work_routing_receipts/.test(c.sql)))
      .toBeLessThan(calls.findIndex((c) => /UPDATE tasks/.test(c.sql)));
    expect(calls.some((c) => /INSERT INTO cecelia_events/.test(c.sql) && /work_route_reanchored/.test(c.params[0]))).toBe(true);
    expect(calls.some((c) => /INSERT INTO task_events/.test(c.sql) && c.params[1] === 'base_sha_reanchored')).toBe(true);
  });

  it('地图 revision 与 base_sha 相同 → 返回 null 且不写库', async () => {
    const { client, calls } = mockClient();
    expect(await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: freshMap(OLD) })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('地图非 fresh → 返回 null', async () => {
    const { client } = mockClient();
    const map = { freshness: { status: 'unknown', repos: { cecelia: { status: 'unknown', source_revision: null } } } };
    expect(await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map })).toBeNull();
  });

  it('map_recovery=true / explicit_recovery / 非 coding_mutation → 返回 null', async () => {
    const { client } = mockClient();
    expect(await reanchorReceiptIfEmptyBranch(client, { task: { ...task, payload: { map_recovery: true } }, receipt: baseReceipt(), map: freshMap() })).toBeNull();
    expect(await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: freshMap(), createdSource: 'explicit_recovery' })).toBeNull();
    expect(await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt({ work_kind: 'coding_review' }), map: freshMap() })).toBeNull();
  });

  it('已有 initiative_runs → 抛 needs_rebase 且不 INSERT', async () => {
    const { client, calls } = mockClient({ hasAnyRun: true });
    await expect(reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: freshMap() }))
      .rejects.toMatchObject({ code: 'needs_rebase', detail: { old_base_sha: OLD, new_base_sha: NEW, branch: 'cp-route-api-1' } });
    expect(calls.some((c) => /INSERT INTO work_routing_receipts/.test(c.sql))).toBe(false);
  });

  it('receipt.has_v2_run=true → 抛 needs_rebase（不查库）', async () => {
    const { client, calls } = mockClient();
    await expect(reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt({ has_v2_run: true }), map: freshMap() }))
      .rejects.toMatchObject({ code: 'needs_rebase' });
    expect(calls).toHaveLength(0);
  });

  it(`快进次数 ≥ ${MAX_FASTFORWARD} → 抛 map_thrash`, async () => {
    const { client } = mockClient();
    const thrashTask = { ...task, metadata: { base_sha_fastforward_count: MAX_FASTFORWARD } };
    await expect(reanchorReceiptIfEmptyBranch(client, { task: thrashTask, receipt: baseReceipt(), map: freshMap() }))
      .rejects.toMatchObject({ code: 'map_thrash', detail: { fastforward_count: MAX_FASTFORWARD } });
  });
});
