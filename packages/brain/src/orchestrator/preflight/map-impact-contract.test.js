import { describe, expect, it, vi } from 'vitest';
import { assertMapImpactContract, ensureMapImpactPreflight } from './map-impact-contract.js';

describe('Map Impact Contract preflight', () => {
  it('accepts only fresh same-repo same-revision contracts', () => {
    const input = { repo: 'perfectuser21/cecelia', base_sha: 'abc', map: { repo: 'perfectuser21/cecelia', freshness: 'fresh', source_revision: 'abc', scanner_valid: true }, impact_contract: { status: 'active', source_revision: 'abc' } };
    expect(assertMapImpactContract(input)).toMatchObject({ impact_contract_policy: 'required' });
    expect(() => assertMapImpactContract({ ...input, map: { ...input.map, freshness: 'stale' } })).toThrow('map_stale');
    expect(() => assertMapImpactContract({ ...input, impact_contract: null })).toThrow('impact_contract_missing');
  });

  it('materializes an active contract only from fresh same-revision Map evidence', async () => {
    const baseSha = 'a'.repeat(40);
    const authority = {
      manifest_version_id: '11111111-1111-4111-8111-111111111111',
      manifest_digest: 'b'.repeat(64),
      projection_run_id: '22222222-2222-4222-8222-222222222222',
      projection_digest: 'c'.repeat(64),
      fact_revisions: { cecelia: baseSha },
    };
    const readMap = vi.fn(async () => ({
      ...authority,
      freshness: {
        status: 'fresh',
        repos: { cecelia: { status: 'fresh', source_revision: baseSha } },
      },
      nodes: [{ key: 'cap-router', type: 'capability', name: 'Router' }],
    }));
    const readRadius = vi.fn(async () => ({
      ...authority,
      freshness: {
        status: 'fresh',
        repos: { cecelia: { status: 'fresh', source_revision: baseSha } },
      },
      affected_business_nodes: [{ node_key: 'cap-router', node_type: 'capability', name: 'Router' }],
      must_run_assertions: [{
        node_key: '11111111-1111-4111-8111-111111111111',
        assertion_ref: 'src/router.test.js',
        assertion_revision: 1,
      }],
    }));
    const persistContract = vi.fn(async (_db, input) => ({
      created: true,
      contract: { id: 'contract-1', ...input, status: 'active' },
    }));
    const client = {
      query: vi.fn(async () => ({ rows: [{ scope_key: 'cecelia' }] })),
    };
    const result = await ensureMapImpactPreflight(client, {
      task: { id: '22222222-2222-4222-8222-222222222222' },
      receipt: {
        repo: 'cecelia',
        change_kind: 'bugfix',
        map_scope: ['cap-router'],
        evidence: { base_sha: baseSha },
      },
    }, {
      readMap,
      readRadius,
      persistContract,
      lockMapProjectionAuthority: vi.fn(async () => authority),
    });

    expect(result.contract).toMatchObject({ status: 'active', repo: 'cecelia' });
    expect(persistContract).toHaveBeenCalledOnce();
    expect(persistContract.mock.calls[0][1].contract_body).toMatchObject({
      affected_capabilities: [{ capability_id: 'cap-router' }],
    });
  });

  it('fails before contract persistence for stale Map evidence', async () => {
    const persistContract = vi.fn();
    const authority = {
      manifest_version_id: '11111111-1111-4111-8111-111111111111',
      manifest_digest: 'b'.repeat(64),
      projection_run_id: '22222222-2222-4222-8222-222222222222',
      projection_digest: 'c'.repeat(64),
      fact_revisions: { cecelia: 'a'.repeat(40) },
    };
    const client = {
      query: vi.fn(async () => ({ rows: [{ scope_key: 'cecelia' }] })),
    };
    await expect(ensureMapImpactPreflight(client, {
      task: { id: '22222222-2222-4222-8222-222222222222' },
      receipt: {
        repo: 'cecelia', change_kind: 'bugfix', map_scope: ['cap-router'],
        evidence: { base_sha: 'a'.repeat(40) },
      },
    }, {
      readMap: vi.fn(async () => ({ freshness: { status: 'unknown' } })),
      readRadius: vi.fn(),
      persistContract,
      lockMapProjectionAuthority: vi.fn(async () => authority),
    })).rejects.toThrow('map_stale');
    expect(persistContract).not.toHaveBeenCalled();
  });

  it('fails closed before persistence when map and radius projection identities drift', async () => {
    const baseSha = 'a'.repeat(40);
    const authority = {
      manifest_version_id: '11111111-1111-4111-8111-111111111111',
      manifest_digest: 'b'.repeat(64),
      projection_run_id: '22222222-2222-4222-8222-222222222222',
      projection_digest: 'c'.repeat(64),
      fact_revisions: { cecelia: baseSha },
    };
    const persistContract = vi.fn();
    await expect(ensureMapImpactPreflight({ query: vi.fn() }, {
      task: { id: '33333333-3333-4333-8333-333333333333', payload: {} },
      receipt: {
        repo: 'cecelia', change_kind: 'bugfix', map_scope: ['cap-router'],
        evidence: { base_sha: baseSha },
      },
    }, {
      resolveScopeKey: vi.fn(async () => 'cecelia'),
      lockMapProjectionAuthority: vi.fn(async () => authority),
      readMap: vi.fn(async () => ({
        ...authority,
        freshness: {
          status: 'fresh',
          repos: { cecelia: { status: 'fresh', source_revision: baseSha } },
        },
      })),
      readRadius: vi.fn(async () => ({
        ...authority,
        projection_run_id: '44444444-4444-4444-8444-444444444444',
        freshness: {
          status: 'fresh',
          repos: { cecelia: { status: 'fresh', source_revision: baseSha } },
        },
        affected_business_nodes: [{
          node_key: 'cap-router', node_type: 'capability', name: 'Router',
        }],
        must_run_assertions: [{
          node_key: '55555555-5555-4555-8555-555555555555',
          assertion_ref: 'src/router.test.js', assertion_revision: 1,
        }],
      })),
      persistContract,
    })).rejects.toThrow('map_projection_changed');
    expect(persistContract).not.toHaveBeenCalled();
  });

  it('rejects an explicit recovery request while the normal Map path is fresh', async () => {
    const baseSha = 'a'.repeat(40);
    const authority = {
      manifest_version_id: '11111111-1111-4111-8111-111111111111',
      manifest_digest: 'b'.repeat(64),
      projection_run_id: '22222222-2222-4222-8222-222222222222',
      projection_digest: 'c'.repeat(64),
      fact_revisions: { cecelia: baseSha },
    };
    const persistContract = vi.fn(async (_db, input) => ({
      created: true, contract: { id: 'normal-contract', status: 'active', ...input },
    }));
    await expect(ensureMapImpactPreflight({ query: vi.fn() }, {
      task: { id: '22222222-2222-4222-8222-222222222222', payload: { map_recovery: true } },
      receipt: {
        repo: 'cecelia', change_kind: 'bugfix', map_scope: ['cap-router'],
        evidence: { base_sha: baseSha },
      },
    }, {
      resolveScopeKey: vi.fn(async () => 'cecelia'),
      readMap: vi.fn(async () => ({
        ...authority,
        freshness: { status: 'fresh', repos: { cecelia: { status: 'fresh', source_revision: baseSha } } },
      })),
      readRadius: vi.fn(async () => ({
        ...authority,
        freshness: { status: 'fresh', repos: { cecelia: { status: 'fresh', source_revision: baseSha } } },
        affected_business_nodes: [{ node_key: 'cap-router', node_type: 'capability', name: 'Router' }],
        must_run_assertions: [{
          assertion_ref: 'src/router.test.js', assertion_revision: 1,
          node_key: '11111111-1111-4111-8111-111111111111',
        }],
      })),
      persistContract,
      lockMapProjectionAuthority: vi.fn(async () => authority),
    })).rejects.toThrow('map_recovery_not_required');
  });

  it('creates a server-authorized recovery contract from last-known-good evidence only after stable Map failure', async () => {
    const baseSha = 'd'.repeat(40);
    const taskId = '22222222-2222-4222-8222-222222222222';
    const receiptId = '33333333-3333-4333-8333-333333333333';
    const lkgBody = {
      affected_capabilities: [{ capability_id: 'cap-map', capability_name: 'Map', impact_level: 'direct' }],
      required_assertions: [{
        assertion_id: 'src/map.test.js', command: 'npx vitest run src/map.test.js',
        covers_capability_ids: ['cap-map'],
        journey_step_link_id: '11111111-1111-4111-8111-111111111111',
        assertion_revision: 1, assertion_digest: 'e'.repeat(64),
        source_bindings: [{
          journey_step_link_id: '11111111-1111-4111-8111-111111111111',
          assertion_revision: 1, assertion_digest: 'e'.repeat(64),
        }],
      }],
    };
    const client = { query: vi.fn(async (sql) => {
      if (/FROM map_scope_repositories/.test(sql)) return { rows: [{ scope_key: 'cecelia' }] };
      if (/FROM map_recovery_contracts recovery/.test(sql)) return { rows: [] };
      if (/FROM harness_impact_contracts/.test(sql)) return { rows: [{
        id: 'lkg-impact-1', manifest_digest: 'b'.repeat(64),
        projection_digest: 'c'.repeat(64), contract_body: lkgBody,
      }] };
      if (/INSERT INTO map_recovery_contracts/.test(sql)) return { rows: [{
        id: 'recovery-1', receipt_id: receiptId, task_id: taskId, repo: 'cecelia',
        branch: 'cp-map-fix', base_sha: baseSha, reason_code: 'map_unavailable',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        authorization_evidence: {
          authorized_by: 'brain-map-preflight', observed_reason_code: 'map_unavailable',
        },
        change_kind: 'bugfix', consumed_attempt_id: null,
      }] };
      throw new Error(`unexpected SQL: ${sql}`);
    }) };
    const persistContract = vi.fn(async (_db, input) => ({
      created: true, contract: { id: 'impact-recovery-1', status: 'active', ...input },
    }));

    const result = await ensureMapImpactPreflight(client, {
      task: {
        id: taskId,
        payload: {
          map_recovery: true,
          changed_files: ['packages/brain/src/lib/map-read-service.js'],
        },
      },
      receipt: {
        id: receiptId, task_id: taskId, repo: 'cecelia', change_kind: 'bugfix',
        map_scope: ['cap-map'], evidence: { branch: 'cp-map-fix', base_sha: baseSha },
      },
    }, {
      readMap: vi.fn(async () => { throw Object.assign(new Error('offline'), { code: 'map_unavailable' }); }),
      persistContract,
      now: new Date(),
      lockMapProjectionAuthority: vi.fn(async () => ({
        manifest_version_id: '11111111-1111-4111-8111-111111111111',
        manifest_digest: 'b'.repeat(64),
        projection_run_id: '22222222-2222-4222-8222-222222222222',
        projection_digest: 'c'.repeat(64),
        fact_revisions: { cecelia: baseSha },
      })),
    });

    expect(result.recovery_contract).toMatchObject({ id: 'recovery-1' });
    expect(result.contract).toMatchObject({ id: 'impact-recovery-1', status: 'active' });
    expect(persistContract.mock.calls[0][1].contract_body).toMatchObject({
      task_id: taskId,
      change_kind: 'bugfix',
      freshness_evidence: { status: 'unknown', reason_code: 'map_unavailable' },
      metadata: { map_recovery_contract_id: 'recovery-1', lkg_impact_contract_id: 'lkg-impact-1' },
    });
  });
});

describe('派发时重锚定 base_sha（任务 d9c405e2）', () => {
  const OLD = 'a'.repeat(40);
  const NEW = 'b'.repeat(40);
  const TASK_ID = '88888888-8888-4888-8888-888888888888';
  const authority = {
    manifest_version_id: '11111111-1111-4111-8111-111111111111',
    manifest_digest: 'b'.repeat(64),
    projection_run_id: '22222222-2222-4222-8222-222222222222',
    projection_digest: 'c'.repeat(64),
    fact_revisions: { cecelia: NEW },
  };
  const freshMap = {
    ...authority,
    freshness: {
      status: 'fresh',
      repos: { cecelia: { status: 'fresh', source_revision: NEW, reason_code: null } },
    },
  };
  const radius = {
    ...authority,
    freshness: { status: 'fresh', repos: { cecelia: { status: 'fresh', source_revision: NEW } } },
    affected_business_nodes: [{ node_type: 'capability', node_key: 'F1', name: '开发闭环' }],
    must_run_assertions: [{
      assertion_ref: 'src/router.test.js',
      journey_step_link_id: '55555555-5555-4555-8555-555555555555',
      assertion_revision: 1,
    }],
  };
  const receipt = {
    id: '66666666-6666-4666-8666-666666666666',
    repo: 'cecelia',
    change_kind: 'bugfix',
    work_kind: 'coding_mutation',
    map_scope: ['F1'],
    has_v2_run: false,
    evidence: { base_sha: OLD, branch: 'cp-route-api-1' },
    anchor_generation: 1,
  };
  const successor = {
    ...receipt,
    id: '77777777-7777-4777-8777-777777777777',
    anchor_generation: 2,
    evidence: { base_sha: NEW, branch: 'cp-route-api-1', prev_base_sha: OLD },
    base_sha: NEW,
  };

  function deps(reanchorReceipt) {
    return {
      resolveScopeKey: vi.fn(async () => 'cecelia'),
      lockMapProjectionAuthority: vi.fn(async () => authority),
      readMap: vi.fn(async () => freshMap),
      readRadius: vi.fn(async () => radius),
      persistContract: vi.fn(async (_c, input) => ({
        contract: { id: 'impact-1', status: 'active' }, input,
      })),
      reanchorReceipt,
    };
  }

  it('地图 revision 前进且分支无产出 → 快进后用新收据继续，合同 base_revision 为新 sha', async () => {
    const reanchorReceipt = vi.fn(async () => successor);
    const d = deps(reanchorReceipt);
    const result = await ensureMapImpactPreflight({ query: vi.fn() }, {
      task: { id: TASK_ID, payload: {}, metadata: {} },
      receipt,
      createdSource: 'kernel_dispatch',
    }, d);
    expect(reanchorReceipt).toHaveBeenCalledOnce();
    expect(reanchorReceipt.mock.calls[0][1]).toMatchObject({
      receipt, createdSource: 'kernel_dispatch',
    });
    expect(d.persistContract.mock.calls[0][1]).toMatchObject({ base_revision: NEW });
    expect(d.persistContract.mock.calls[0][1].contract_body.freshness_evidence.mapper_revision)
      .toBe(NEW);
    expect(result.receipt).toMatchObject({ id: successor.id, anchor_generation: 2 });
    expect(result.contract).toMatchObject({ status: 'active' });
  });

  it('无法快进（reanchor 返回 null）→ 仍抛 map_revision_mismatch 且不持久化合同', async () => {
    const d = deps(vi.fn(async () => null));
    await expect(ensureMapImpactPreflight({ query: vi.fn() }, {
      task: { id: TASK_ID, payload: {} }, receipt,
    }, d)).rejects.toThrow('map_revision_mismatch');
    expect(d.persistContract).not.toHaveBeenCalled();
  });

  it('reanchor 抛 needs_rebase → 原样上抛（不进 recovery 通道）', async () => {
    const err = Object.assign(new Error('needs_rebase'), {
      code: 'needs_rebase', detail: { old_base_sha: OLD },
    });
    const d = deps(vi.fn(async () => { throw err; }));
    await expect(ensureMapImpactPreflight({ query: vi.fn() }, {
      task: { id: TASK_ID, payload: { map_recovery: true } }, receipt,
    }, d)).rejects.toMatchObject({ code: 'needs_rebase' });
    expect(d.persistContract).not.toHaveBeenCalled();
  });

  it('revision 一致时不调用 reanchor', async () => {
    const reanchorReceipt = vi.fn();
    const d = deps(reanchorReceipt);
    await ensureMapImpactPreflight({ query: vi.fn() }, {
      task: { id: TASK_ID, payload: {} },
      receipt: { ...receipt, evidence: { base_sha: NEW, branch: 'cp-route-api-1' } },
    }, d);
    expect(reanchorReceipt).not.toHaveBeenCalled();
  });
});
