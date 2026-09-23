import { describe, expect, it, vi } from 'vitest';
import { reanchorReceiptIfEmptyBranch, MAX_FASTFORWARD } from './base-sha-reanchor.js';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const TASK_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TASK_ID = '99999999-9999-4999-8999-999999999999';
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
function mockClient({ hasAnyRun = false, successorEvidence, failSql = null } = {}) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (failSql?.test(sql)) throw new Error('db boom');
      if (/AS has_any_run/.test(sql)) return { rows: [{ has_any_run: hasAnyRun }] };
      if (/INSERT INTO work_routing_receipts/.test(sql)) {
        const evidence = successorEvidence === undefined ? JSON.parse(params[15]) : successorEvidence;
        return { rows: [{ ...baseReceipt(), id: NEXT_ID, anchor_generation: params[19], supersedes_receipt_id: params[18], evidence }] };
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
const writes = (calls) => calls.filter((c) => /INSERT INTO|UPDATE tasks/.test(c.sql));

describe('reanchorReceiptIfEmptyBranch', () => {
  it('无产出 + 地图前进 → 插接班收据、同步 payload、留痕，返回新收据与新 base_sha', async () => {
    const { client, calls } = mockClient();
    const result = await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: freshMap(), now: new Date('2026-09-23T09:00:00Z') });
    expect(result.id).toBe(NEXT_ID);
    expect(result.anchor_generation).toBe(2);
    expect(result.base_sha).toBe(NEW);
    expect(result.evidence).toMatchObject({ base_sha: NEW, prev_base_sha: OLD, reanchor_reason: 'map_revision_advanced' });
    expect(result.has_v2_run).toBe(false);
    const insert = calls.find((c) => /INSERT INTO work_routing_receipts/.test(c.sql));
    expect(insert.params[0]).toBe(TASK_ID);            // task_id 取自 task.id
    expect(JSON.parse(insert.params[15])).toMatchObject({
      branch: 'cp-route-api-1', base_sha: NEW, prev_base_sha: OLD, reanchor_reason: 'map_revision_advanced',
    });
    expect(insert.params[18]).toBe(RECEIPT_ID); // supersedes_receipt_id
    expect(insert.params[19]).toBe(2);           // anchor_generation
    const update = calls.find((c) => /UPDATE tasks/.test(c.sql));
    expect(JSON.parse(update.params[1])).toMatchObject({ routing_receipt_id: NEXT_ID, base_sha: NEW });
    expect(JSON.parse(update.params[2])).toMatchObject({ base_sha_fastforward_count: 1 });
    // 顺序：先 INSERT 收据，后 UPDATE tasks（421 触发器按最新收据比对）
    expect(calls.findIndex((c) => /INSERT INTO work_routing_receipts/.test(c.sql)))
      .toBeLessThan(calls.findIndex((c) => /UPDATE tasks/.test(c.sql)));
    expect(calls.some((c) => /INSERT INTO cecelia_events/.test(c.sql) && /work_route_reanchored/.test(c.params[0]))).toBe(true);
    const taskEvent = calls.find((c) => /INSERT INTO task_events/.test(c.sql));
    expect(taskEvent.params[1]).toBe('base_sha_reanchored');
    expect(JSON.parse(taskEvent.params[2])).toMatchObject({ new_base_sha: NEW, anchor_generation: 2 });
  });

  it('task_events 写失败 → 错误上抛（事务内不得吞错）', async () => {
    const { client } = mockClient({ failSql: /INSERT INTO task_events/ });
    await expect(reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: freshMap() }))
      .rejects.toThrow('db boom');
  });

  it('地图 revision 与 base_sha 相同 → 返回 null 且不写库', async () => {
    const { client, calls } = mockClient();
    expect(await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: freshMap(OLD) })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('repo 非 fresh 或 map 级非 fresh → 返回 null', async () => {
    const { client } = mockClient();
    const repoStale = { freshness: { status: 'fresh', repos: { cecelia: { status: 'unknown', source_revision: null } } } };
    expect(await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: repoStale })).toBeNull();
    const mapStale = { freshness: { status: 'stale', repos: { cecelia: { status: 'fresh', source_revision: NEW } } } };
    expect(await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: mapStale })).toBeNull();
  });

  it('map_recovery=true / explicit_recovery / 非 coding_mutation / 无旧 base_sha → 返回 null', async () => {
    const { client, calls } = mockClient();
    expect(await reanchorReceiptIfEmptyBranch(client, { task: { ...task, payload: { map_recovery: true } }, receipt: baseReceipt(), map: freshMap() })).toBeNull();
    expect(await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: freshMap(), createdSource: 'explicit_recovery' })).toBeNull();
    expect(await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt({ work_kind: 'coding_review' }), map: freshMap() })).toBeNull();
    expect(await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt({ evidence: null }), map: freshMap() })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('已有 initiative_runs → 抛 needs_rebase，不写库，且两列各走一个 EXISTS', async () => {
    const { client, calls } = mockClient({ hasAnyRun: true });
    await expect(reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: freshMap() }))
      .rejects.toMatchObject({ code: 'needs_rebase', detail: { old_base_sha: OLD, new_base_sha: NEW, branch: 'cp-route-api-1' } });
    expect(writes(calls)).toHaveLength(0);
    const probe = calls.find((c) => /AS has_any_run/.test(c.sql));
    expect(probe.sql).toMatch(/EXISTS[\s\S]*current_task_id[\s\S]*OR[\s\S]*EXISTS[\s\S]*initiative_id/);
  });

  it('receipt.has_v2_run=true → 抛 needs_rebase（不查库）', async () => {
    const { client, calls } = mockClient();
    await expect(reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt({ has_v2_run: true }), map: freshMap() }))
      .rejects.toMatchObject({ code: 'needs_rebase' });
    expect(calls).toHaveLength(0);
  });

  it(`快进次数 ≥ ${MAX_FASTFORWARD} → 抛 map_thrash 且零写库`, async () => {
    const { client, calls } = mockClient();
    const thrashTask = { ...task, metadata: { base_sha_fastforward_count: MAX_FASTFORWARD } };
    await expect(reanchorReceiptIfEmptyBranch(client, { task: thrashTask, receipt: baseReceipt(), map: freshMap() }))
      .rejects.toMatchObject({ code: 'map_thrash', detail: { fastforward_count: MAX_FASTFORWARD } });
    expect(writes(calls)).toHaveLength(0);
  });

  it('有产出优先报 needs_rebase：has_v2_run=true 且计数已达上限', async () => {
    const { client, calls } = mockClient();
    const thrashTask = { ...task, metadata: { base_sha_fastforward_count: MAX_FASTFORWARD } };
    await expect(reanchorReceiptIfEmptyBranch(client, { task: thrashTask, receipt: baseReceipt({ has_v2_run: true }), map: freshMap() }))
      .rejects.toMatchObject({ code: 'needs_rebase' });
    expect(calls).toHaveLength(0);
  });

  it('task.metadata 未取列（undefined）→ 抛 task_metadata_missing 且零写库', async () => {
    const { client, calls } = mockClient();
    await expect(reanchorReceiptIfEmptyBranch(client, { task: { id: TASK_ID, payload: {} }, receipt: baseReceipt(), map: freshMap() }))
      .rejects.toMatchObject({ code: 'task_metadata_missing', detail: { task_id: TASK_ID } });
    expect(calls).toHaveLength(0);
  });

  it('task.metadata 为 null（列值 NULL）→ 视为 {} 正常快进', async () => {
    const { client, calls } = mockClient();
    const result = await reanchorReceiptIfEmptyBranch(client, { task: { id: TASK_ID, payload: {}, metadata: null }, receipt: baseReceipt(), map: freshMap() });
    expect(result.base_sha).toBe(NEW);
    const update = calls.find((c) => /UPDATE tasks/.test(c.sql));
    expect(JSON.parse(update.params[2]).base_sha_fastforward_count).toBe(1);
  });

  it('快进计数为脏值 → 按 0 处理并告警，写回有限整数 1', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client, calls } = mockClient();
    const dirtyTask = { ...task, metadata: { base_sha_fastforward_count: 'abc' } };
    const result = await reanchorReceiptIfEmptyBranch(client, { task: dirtyTask, receipt: baseReceipt(), map: freshMap() });
    expect(result.base_sha).toBe(NEW);
    const update = calls.find((c) => /UPDATE tasks/.test(c.sql));
    expect(JSON.parse(update.params[2]).base_sha_fastforward_count).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(TASK_ID);
    expect(warn.mock.calls[0][0]).toContain('abc');
    warn.mockRestore();
  });

  it('receipt.task_id 与 task.id 不一致 → 抛 receipt_task_mismatch 且零写库', async () => {
    const { client, calls } = mockClient();
    await expect(reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt({ task_id: OTHER_TASK_ID }), map: freshMap() }))
      .rejects.toMatchObject({ code: 'receipt_task_mismatch', detail: { task_id: TASK_ID, receipt_task_id: OTHER_TASK_ID } });
    expect(calls).toHaveLength(0);
  });

  it('INSERT RETURNING 的 evidence 为 null → 返回体仍带本地构造的 evidence 对象', async () => {
    const { client, calls } = mockClient({ successorEvidence: null });
    const result = await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: freshMap() });
    expect(result.evidence).toMatchObject({ base_sha: NEW, prev_base_sha: OLD });
    const insert = calls.find((c) => /INSERT INTO work_routing_receipts/.test(c.sql));
    expect(JSON.parse(insert.params[15]).base_sha).toBe(NEW);
  });
});
