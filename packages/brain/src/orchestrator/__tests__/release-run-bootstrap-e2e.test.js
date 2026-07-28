import { describe, expect, it, vi } from 'vitest';

import {
  executeBootstrapE2EManifest,
  materializeBootstrapE2EManifest,
} from '../release-run-bootstrap-e2e.js';

const BOOTSTRAP_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const CONTRACT_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const MANIFEST_ID = '55555555-5555-4555-8555-555555555555';
const SOURCE_SHA = 'a'.repeat(40);
const MERGE_SHA = 'b'.repeat(40);
const APPROVED_AT = '2026-07-28T06:00:00.000Z';
const artifacts = [{
  name: 'brain',
  version: '1.268.6',
  digest: `sha256:${'c'.repeat(64)}`,
}];
const acceptance = {
  scenarios: [{
    name: 'bootstrap contract behavior',
    covered_tasks: [TASK_ID],
    commands: [{ type: 'probe', id: 'brain.health' }],
  }],
};

function authority() {
  return {
    bootstrap_run_id: BOOTSTRAP_ID,
    run_id: RUN_ID,
    repository: 'perfectuser21/cecelia',
    source_head_sha: SOURCE_SHA,
    merge_sha: MERGE_SHA,
    contract_id: CONTRACT_ID,
    contract_version: 4,
    contract_approved_at: APPROVED_AT,
    contract_content: '# approved bootstrap contract',
    e2e_acceptance: acceptance,
  };
}

function fakeClient({ authorityRow = authority() } = {}) {
  let persisted;
  return {
    query: vi.fn(async (sql, params) => {
      if (/SELECT bootstrap\.id AS bootstrap_run_id/.test(sql)) {
        return { rows: authorityRow ? [authorityRow] : [] };
      }
      if (/INSERT INTO kernel_release_bootstrap_e2e_manifests/.test(sql)) {
        persisted = {
          id: MANIFEST_ID,
          bootstrap_run_id: params[0],
          run_id: params[1],
          repository: params[2],
          merge_sha: params[3],
          artifact_versions: JSON.parse(params[4]),
          artifact_set_digest: params[5],
          contract_id: params[6],
          contract_version: params[7],
          contract_approved_at: params[8],
          contract_digest: params[10],
          policy_version: params[11],
          e2e_acceptance: JSON.parse(params[12]),
          e2e_acceptance_digest: params[13],
          scenarios_total: params[14],
          manifest_digest: params[15],
        };
        return { rows: [], rowCount: 1 };
      }
      if (/FROM kernel_release_bootstrap_e2e_manifests/.test(sql)) {
        return { rows: persisted ? [persisted] : [] };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
}

describe('bootstrap required contract E2E manifest', () => {
  it('materializes one exact approved merge-contract manifest transactionally', async () => {
    const client = fakeClient();

    await expect(materializeBootstrapE2EManifest(client, {
      bootstrap_run_id: BOOTSTRAP_ID,
      repository: 'perfectuser21/cecelia',
      source_head_sha: SOURCE_SHA,
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
    })).resolves.toMatchObject({
      id: MANIFEST_ID,
      release_run_id: BOOTSTRAP_ID,
      run_id: RUN_ID,
      repository: 'perfectuser21/cecelia',
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
      scenarios_total: 1,
    });

    const sql = client.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toMatch(
      /BEGIN[\s\S]+?pg_advisory_xact_lock[\s\S]+?kernel_merge_effect_receipts[\s\S]+?receipt_status = 'confirmed'[\s\S]+?INSERT INTO kernel_release_bootstrap_e2e_manifests[\s\S]+?COMMIT/,
    );
  });

  it('fails closed without the exact approved merge-contract authority', async () => {
    const client = fakeClient({ authorityRow: null });
    await expect(materializeBootstrapE2EManifest(client, {
      bootstrap_run_id: BOOTSTRAP_ID,
      repository: 'perfectuser21/cecelia',
      source_head_sha: SOURCE_SHA,
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
    })).rejects.toThrow('release_bootstrap_e2e_authority_missing');
    expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
  });

  it('executes only the persisted manifest with exact live artifact readback', async () => {
    const client = fakeClient();
    const manifest = await materializeBootstrapE2EManifest(client, {
      bootstrap_run_id: BOOTSTRAP_ID,
      repository: 'perfectuser21/cecelia',
      source_head_sha: SOURCE_SHA,
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
    });
    const fetchFn = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ status: 'healthy' }),
    }));

    await expect(executeBootstrapE2EManifest(manifest, {
      environment: 'staging',
      artifact_readback: artifacts,
      fetchFn,
      endpoints: {
        brain: 'http://staging:5222',
        dashboard: 'http://dashboard-staging:5211',
      },
    })).resolves.toMatchObject({
      status: 'pass',
      environment: 'staging',
      merge_sha: MERGE_SHA,
      artifact_readback: artifacts,
      scenarios_total: 1,
      scenarios_passed: 1,
    });
    expect(fetchFn.mock.calls[0][0]).toBe(
      'http://staging:5222/api/brain/health',
    );
  });

  it('rejects a wrong live artifact readback before running commands', async () => {
    const client = fakeClient();
    const manifest = await materializeBootstrapE2EManifest(client, {
      bootstrap_run_id: BOOTSTRAP_ID,
      repository: 'perfectuser21/cecelia',
      source_head_sha: SOURCE_SHA,
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
    });
    const fetchFn = vi.fn();
    await expect(executeBootstrapE2EManifest(manifest, {
      environment: 'production',
      artifact_readback: [{ ...artifacts[0], digest: `sha256:${'e'.repeat(64)}` }],
      fetchFn,
      endpoints: {
        brain: 'http://brain:5221',
        dashboard: 'http://dashboard:5211',
      },
    })).rejects.toThrow('release_e2e_execution_artifacts_mismatch');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
