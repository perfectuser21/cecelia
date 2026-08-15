import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createDirectProfileContractMaterializer } from '../direct-profile-contract.js';

const RUN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TASK_ID = '11111111-2222-4333-8444-555555555555';
const INITIATIVE_ID = '22222222-3333-4444-8555-666666666666';
const RECEIPT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const IMPACT_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const BASE_SHA = 'a'.repeat(40);

function hashBody(body) {
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((result, key) => {
        if (key !== 'checked_at' && value[key] !== undefined) result[key] = normalize(value[key]);
        return result;
      }, {});
    }
    return value;
  };
  return createHash('sha256').update(JSON.stringify(normalize(body))).digest('hex');
}

function authority(overrides = {}) {
  const contractBody = {
    schema_version: 1,
    task_id: TASK_ID,
    change_kind: 'bugfix',
    repo: 'cecelia',
    base_revision: BASE_SHA,
    required_assertions: [{
      assertion_id: 'journey:callback-cas',
      command: 'npm test -- callback-cas',
      covers_capability_ids: ['F1'],
    }],
  };
  return {
    run: {
      id: RUN_ID,
      initiative_id: INITIATIVE_ID,
      current_task_id: TASK_ID,
      contract_id: null,
      phase: 'generate',
    },
    receipt: {
      id: RECEIPT_ID,
      task_id: TASK_ID,
      task_status: 'in_progress',
      work_kind: 'coding_mutation',
      change_kind: 'bugfix',
      default_execution_profile: 'hotfix-v1',
      execution_profile_override: null,
      repo: 'cecelia',
      evidence: { branch: 'cp-direct-contract', base_sha: BASE_SHA },
      direct_contract_seed: {
        contract_version: 'direct-profile-contract-seed/v1',
        title: 'Repair callback ownership',
        objective: 'Preserve exact lease CAS.',
        execution_profile: 'hotfix-v1',
      },
    },
    impact: {
      id: IMPACT_ID,
      task_id: TASK_ID,
      status: 'active',
      base_revision: BASE_SHA,
      contract_hash: hashBody(contractBody),
      contract_body: contractBody,
    },
    ...overrides,
  };
}

function fakeDb(snapshot = authority()) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, args) => {
      const text = String(sql);
      calls.push([text, args]);
      if (text.includes('FROM initiative_runs')) {
        return { rows: [snapshot.run] };
      }
      if (text.includes('SELECT task.status') && text.includes('FROM tasks')) {
        return { rows: snapshot.receipt ? [{ status: snapshot.receipt.task_status }] : [] };
      }
      if (text.includes('FROM work_routing_receipts') && text.includes('FOR SHARE')) {
        return { rows: snapshot.receipt ? [snapshot.receipt] : [] };
      }
      if (text.includes('FROM harness_impact_contracts') && text.includes('FOR SHARE')) {
        return { rows: snapshot.impact ? [snapshot.impact] : [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    pool: { connect: vi.fn(async () => client) },
    client,
    calls,
  };
}

describe('direct profile frozen contract materializer', () => {
  it('locks DB authority and mechanically creates core, test, seal input, and provenance', async () => {
    const { pool, client, calls } = fakeDb();
    const materializeApprovedContract = vi.fn(async (_client, input) => ({
      id: 'contract-direct',
      ...input,
    }));
    const materialize = createDirectProfileContractMaterializer({
      pool,
      materializeApprovedContract,
      now: () => new Date('2026-08-15T00:00:00.000Z'),
    });

    await expect(materialize(RUN_ID)).resolves.toMatchObject({ id: 'contract-direct' });

    expect(calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      expect.stringMatching(/initiative_runs(?![\s\S]*FOR UPDATE)/),
      expect.stringMatching(/pg_advisory_xact_lock\(hashtextextended/),
      expect.stringMatching(/FROM tasks[\s\S]*FOR UPDATE/),
      expect.stringMatching(/initiative_runs[\s\S]*initiative_id = \$2[\s\S]*current_task_id = \$3[\s\S]*FOR UPDATE/),
      expect.stringMatching(/work_routing_receipts[\s\S]*FOR SHARE OF receipt/),
      expect.stringMatching(/harness_impact_contracts[\s\S]*FOR SHARE/),
      'COMMIT',
    ]);
    expect(calls[2][1]).toEqual([`contract-initiative:${INITIATIVE_ID}`]);
    const input = materializeApprovedContract.mock.calls[0][1];
    expect(materializeApprovedContract.mock.calls[0][0]).toBe(client);
    expect(input.runId).toBe(RUN_ID);
    expect(input.approvedSha).toBeUndefined();
    expect(input.artifacts.map(({ path }) => path)).toEqual([
      `direct-contracts/${RECEIPT_ID}/contract-dod.md`,
      `direct-contracts/${RECEIPT_ID}/contract-draft.md`,
      `direct-contracts/${RECEIPT_ID}/sprint-prd.md`,
      `direct-contracts/${RECEIPT_ID}/tests/impact-contract.md`,
    ]);
    expect(input.artifacts.every(({ source_revision }) => source_revision === BASE_SHA)).toBe(true);
    expect(input.prdContent).toContain('Preserve exact lease CAS.');
    expect(input.contractContent).toContain('journey:callback-cas');
    expect(input.contractContent).toContain('npm test -- callback-cas');
    expect(input.approvalProvenance).toEqual({
      kind: 'direct',
      policy_version: 'direct-profile-contract-policy/v1',
      routing_receipt_id: RECEIPT_ID,
      impact_contract_id: IMPACT_ID,
      impact_contract_hash: authority().impact.contract_hash,
      input_base_sha: BASE_SHA,
    });
  });

  it('never selects or projects mutable task description/thin_prd', async () => {
    const snapshot = authority();
    snapshot.run.description = 'POISON TASK DESCRIPTION';
    snapshot.run.thin_prd = 'POISON THIN PRD';
    const { pool, calls } = fakeDb(snapshot);
    const materializeApprovedContract = vi.fn(async (_client, input) => input);
    const materialize = createDirectProfileContractMaterializer({ pool, materializeApprovedContract });

    await materialize(RUN_ID);

    const sql = calls.map(([text]) => text).join('\n');
    const input = materializeApprovedContract.mock.calls[0][1];
    expect(sql).not.toMatch(/description|thin_prd/i);
    expect(JSON.stringify(input)).not.toContain('POISON');
  });

  it.each([
    ['seed_missing', (snapshot) => { snapshot.receipt.direct_contract_seed = null; }],
    ['receipt_task_mismatch', (snapshot) => { snapshot.receipt.task_id = crypto.randomUUID(); }],
    ['impact_missing', (snapshot) => { snapshot.impact = null; }],
    ['impact_revision_mismatch', (snapshot) => { snapshot.impact.base_revision = 'b'.repeat(40); }],
    ['impact_hash_mismatch', (snapshot) => { snapshot.impact.contract_hash = 'f'.repeat(64); }],
  ])('rolls back deterministic invalid authority: %s', async (reason, mutate) => {
    const snapshot = authority();
    mutate(snapshot);
    const { pool, calls } = fakeDb(snapshot);
    const materializeApprovedContract = vi.fn();
    const materialize = createDirectProfileContractMaterializer({ pool, materializeApprovedContract });

    await expect(materialize(RUN_ID)).rejects.toMatchObject({
      code: 'DIRECT_PROFILE_CONTRACT_INVALID',
      message: `DIRECT_PROFILE_CONTRACT_INVALID:${reason}`,
    });
    expect(calls.at(-1)[0]).toBe('ROLLBACK');
    expect(materializeApprovedContract).not.toHaveBeenCalled();
  });
});
