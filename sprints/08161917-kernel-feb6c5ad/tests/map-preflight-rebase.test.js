import { describe, expect, it, vi } from 'vitest';
import { ensureMapImpactPreflight } from '../../../packages/brain/src/orchestrator/preflight/map-impact-contract.js';

// TDD Red 阶段测试 — 起跑 Map 预检 base_sha 落后 main 按祖先重定基（sprint 08161917-kernel-feb6c5ad）。
// 这些用例断言「祖先重定基 / map_revision_diverged / fail-closed / error-path」新行为，
// 对当前实现（line 259 无条件抛 map_revision_mismatch）应全部失败（Red）。
// generator 落地时把这些用例合并进
// packages/brain/src/orchestrator/preflight/map-impact-contract.test.js（in-repo 回归测试）。

const OLD_SHA = 'a'.repeat(40);
const MAP_SHA = 'f'.repeat(40); // map 前进后的新 revision（假定为 OLD_SHA 的后裔）

function authorityFixture() {
  return {
    manifest_version_id: '11111111-1111-4111-8111-111111111111',
    manifest_digest: 'b'.repeat(64),
    projection_run_id: '22222222-2222-4222-8222-222222222222',
    projection_digest: 'c'.repeat(64),
    fact_revisions: { cecelia: MAP_SHA },
  };
}

function freshMapAt(revision) {
  const authority = authorityFixture();
  return {
    ...authority,
    freshness: {
      status: 'fresh',
      repos: { cecelia: { status: 'fresh', source_revision: revision, reason_code: 'scan_ok' } },
    },
  };
}

function freshRadiusAt(revision) {
  const authority = authorityFixture();
  return {
    ...authority,
    freshness: {
      status: 'fresh',
      repos: { cecelia: { status: 'fresh', source_revision: revision } },
    },
    affected_business_nodes: [{ node_key: 'cap-router', node_type: 'capability', name: 'Router' }],
    must_run_assertions: [{
      node_key: '11111111-1111-4111-8111-111111111111',
      assertion_ref: 'src/router.test.js',
      assertion_revision: 1,
    }],
  };
}

function baseContext(overridesPayload = {}) {
  return {
    task: { id: '99999999-9999-4999-8999-999999999999', payload: { ...overridesPayload } },
    receipt: {
      id: '88888888-8888-4888-8888-888888888888',
      task_id: '99999999-9999-4999-8999-999999999999',
      repo: 'cecelia',
      change_kind: 'bugfix',
      map_scope: ['cap-router'],
      evidence: { base_sha: OLD_SHA, branch: 'cp-map-fix' },
    },
  };
}

// fake client.query，按 SQL regex 分派；runStarted 控制 initiative_runs 命中，
// eventThrows 模拟 route_rebased 写失败。捕获所有调用供断言。
function makeClient({ runStarted = false, eventThrows = false } = {}) {
  const calls = [];
  const query = vi.fn(async (sql, params) => {
    calls.push({ sql: String(sql), params });
    if (/FROM map_scope_repositories/i.test(sql)) return { rows: [{ scope_key: 'cecelia' }] };
    if (/FROM initiative_runs/i.test(sql)) {
      return { rows: runStarted ? [{ id: 'run-1' }] : [] };
    }
    if (/route_rebased/i.test(sql) || /INSERT INTO cecelia_events/i.test(sql)) {
      if (eventThrows) throw new Error('event_write_failed');
      return { rows: [{ id: 'evt-1' }] };
    }
    if (/UPDATE work_routing_receipts/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/UPDATE tasks/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
  return { query, calls };
}

function routeRebasedIssued(calls) {
  return calls.some(({ sql, params }) => {
    const blob = `${sql} ${JSON.stringify(params ?? [])}`;
    return /route_rebased/i.test(blob) && blob.includes(OLD_SHA);
  });
}

describe('Map preflight base_sha rebase [BEHAVIOR]', () => {
  it('rebases receipt base_sha to map revision when behind but ancestor and run not started', async () => {
    const client = makeClient({ runStarted: false });
    const persistContract = vi.fn(async (_db, input) => ({
      created: true, contract: { id: 'c-1', status: 'active', ...input },
    }));
    const result = await ensureMapImpactPreflight(client, baseContext(), {
      resolveScopeKey: vi.fn(async () => 'cecelia'),
      lockMapProjectionAuthority: vi.fn(async () => authorityFixture()),
      readMap: vi.fn(async () => freshMapAt(MAP_SHA)),
      readRadius: vi.fn(async () => freshRadiusAt(MAP_SHA)),
      isAncestor: vi.fn(async () => true),
      hasRunStarted: vi.fn(async () => false),
      persistContract,
      now: new Date('2026-08-16T00:00:00Z'),
    });
    expect(result.contract).toMatchObject({ status: 'active' });
    expect(persistContract).toHaveBeenCalledOnce();
    expect(persistContract.mock.calls[0][1].base_revision).toBe(MAP_SHA);
    expect(routeRebasedIssued(client.calls)).toBe(true);
  });

  it('throws map_revision_diverged when map revision is not a descendant of base_sha', async () => {
    const client = makeClient({ runStarted: false });
    const persistContract = vi.fn();
    await expect(ensureMapImpactPreflight(client, baseContext(), {
      resolveScopeKey: vi.fn(async () => 'cecelia'),
      lockMapProjectionAuthority: vi.fn(async () => authorityFixture()),
      readMap: vi.fn(async () => freshMapAt(MAP_SHA)),
      readRadius: vi.fn(async () => freshRadiusAt(MAP_SHA)),
      isAncestor: vi.fn(async () => false),
      hasRunStarted: vi.fn(async () => false),
      persistContract,
    })).rejects.toThrow('map_revision_diverged');
    expect(persistContract).not.toHaveBeenCalled();
    expect(routeRebasedIssued(client.calls)).toBe(false);
  });

  it('does not rebase when a run has already started for the task', async () => {
    const client = makeClient({ runStarted: true });
    const persistContract = vi.fn();
    await expect(ensureMapImpactPreflight(client, baseContext(), {
      resolveScopeKey: vi.fn(async () => 'cecelia'),
      lockMapProjectionAuthority: vi.fn(async () => authorityFixture()),
      readMap: vi.fn(async () => freshMapAt(MAP_SHA)),
      readRadius: vi.fn(async () => freshRadiusAt(MAP_SHA)),
      isAncestor: vi.fn(async () => true),
      hasRunStarted: vi.fn(async () => true),
      persistContract,
    })).rejects.toThrow('map_revision_mismatch');
    expect(persistContract).not.toHaveBeenCalled();
    expect(routeRebasedIssued(client.calls)).toBe(false);
  });

  it('throws map_stale when map is not fresh', async () => {
    const client = makeClient();
    const persistContract = vi.fn();
    await expect(ensureMapImpactPreflight(client, baseContext(), {
      resolveScopeKey: vi.fn(async () => 'cecelia'),
      lockMapProjectionAuthority: vi.fn(async () => authorityFixture()),
      readMap: vi.fn(async () => ({ ...authorityFixture(), freshness: { status: 'unknown' } })),
      readRadius: vi.fn(),
      isAncestor: vi.fn(async () => true),
      hasRunStarted: vi.fn(async () => false),
      persistContract,
    })).rejects.toThrow('map_stale');
    expect(persistContract).not.toHaveBeenCalled();
  });

  it('treats unreachable ancestry as diverged and does not rebase', async () => {
    const client = makeClient({ runStarted: false });
    const persistContract = vi.fn();
    await expect(ensureMapImpactPreflight(client, baseContext(), {
      resolveScopeKey: vi.fn(async () => 'cecelia'),
      lockMapProjectionAuthority: vi.fn(async () => authorityFixture()),
      readMap: vi.fn(async () => freshMapAt(MAP_SHA)),
      readRadius: vi.fn(async () => freshRadiusAt(MAP_SHA)),
      isAncestor: vi.fn(async () => { throw new Error('git object unreachable'); }),
      hasRunStarted: vi.fn(async () => false),
      persistContract,
    })).rejects.toThrow('map_revision_diverged');
    expect(persistContract).not.toHaveBeenCalled();
    expect(routeRebasedIssued(client.calls)).toBe(false);
  });

  it('still materializes contract on same-revision fresh map without route_rebased', async () => {
    const client = makeClient({ runStarted: false });
    const persistContract = vi.fn(async (_db, input) => ({
      created: true, contract: { id: 'c-same', status: 'active', ...input },
    }));
    const result = await ensureMapImpactPreflight(client, baseContext(), {
      resolveScopeKey: vi.fn(async () => 'cecelia'),
      lockMapProjectionAuthority: vi.fn(async () => authorityFixture()),
      readMap: vi.fn(async () => freshMapAt(OLD_SHA)),
      readRadius: vi.fn(async () => freshRadiusAt(OLD_SHA)),
      isAncestor: vi.fn(async () => true),
      hasRunStarted: vi.fn(async () => false),
      persistContract,
    });
    expect(result.contract).toMatchObject({ status: 'active' });
    expect(persistContract.mock.calls[0][1].base_revision).toBe(OLD_SHA);
    expect(routeRebasedIssued(client.calls)).toBe(false);
  });

  it('fail-closed when route_rebased event write fails', async () => {
    const client = makeClient({ runStarted: false, eventThrows: true });
    const persistContract = vi.fn();
    await expect(ensureMapImpactPreflight(client, baseContext(), {
      resolveScopeKey: vi.fn(async () => 'cecelia'),
      lockMapProjectionAuthority: vi.fn(async () => authorityFixture()),
      readMap: vi.fn(async () => freshMapAt(MAP_SHA)),
      readRadius: vi.fn(async () => freshRadiusAt(MAP_SHA)),
      isAncestor: vi.fn(async () => true),
      hasRunStarted: vi.fn(async () => false),
      persistContract,
    })).rejects.toThrow();
    expect(persistContract).not.toHaveBeenCalled();
  });
});
