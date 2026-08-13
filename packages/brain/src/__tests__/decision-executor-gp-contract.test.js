import { beforeEach, describe, expect, it, vi } from 'vitest';

import { approvePendingAction } from '../decision-executor.js';
import pool from '../db.js';


vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock('../actions.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));

function makeSigningClient({ failTaskInsert = false, stale = false } = {}) {
  const sqlLog = [];
  const pendingAction = {
    id: 'action-sign-1',
    action_type: 'sign_golden_path_contract',
    status: 'pending_approval',
    expires_at: null,
    params: {
      golden_path_id: 'gp-1',
      contract_id: 'contract-1',
      version: 1,
      content_hash: 'a'.repeat(64),
    },
    context: { title: '签 GP 合同' },
  };
  const contract = {
    id: stale ? 'contract-2' : 'contract-1',
    golden_path_id: 'gp-1',
    version: stale ? 2 : 1,
    content_hash: stale ? 'b'.repeat(64) : 'a'.repeat(64),
    status: 'pending_signature',
  };
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql, params = []) => {
      const compact = sql.replace(/\s+/g, ' ').trim();
      sqlLog.push(compact);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(compact)) {
        return { rows: [], rowCount: 0 };
      }
      if (/FROM pending_actions/i.test(compact)) {
        return { rows: [pendingAction], rowCount: 1 };
      }
      if (/FROM golden_paths/i.test(compact) && /FOR UPDATE/i.test(compact)) {
        return {
          rows: [{
            id: 'gp-1',
            title: '朋友圈 GP',
            one_liner: '用户发朋友圈',
            journey_id: 'journey-1',
            proposal_doc: '# proposal',
            status: 'converged',
            change_kind: 'new_capability',
            map_scope: ['capability_social_feed'],
          }],
        };
      }
      if (/FROM golden_path_contract_versions/i.test(compact)) {
        return { rows: [contract] };
      }
      if (/FROM tasks/i.test(compact)) {
        return { rows: [] };
      }
      if (/FROM map_scope_repositories AS repositories/i.test(compact)) {
        return { rows: [{ repo: 'cecelia', source_revision: 'a'.repeat(40) }] };
      }
      if (/SELECT scope_key, repo, adapter_config FROM map_scope_repositories/i.test(compact)) {
        return {
          rows: [{
            scope_key: 'cecelia',
            repo: 'cecelia',
            adapter_config: { aliases: ['perfectuser21/cecelia'] },
          }],
        };
      }
      if (/pg_advisory_xact_lock/i.test(compact)) {
        return { rows: [] };
      }
      if (/INSERT INTO cecelia_events/i.test(compact)) {
        return { rows: [] };
      }
      if (/FROM work_routing_receipts r/i.test(compact)) {
        return { rows: [] };
      }
      if (/INSERT INTO decisions/i.test(compact)) {
        return { rows: [{ id: 'decision-1' }] };
      }
      if (
        /UPDATE golden_path_contract_versions/i.test(compact)
        && /status = 'signed'/i.test(compact)
      ) {
        contract.status = 'signed';
        contract.signature_decision_id = 'decision-1';
        return { rows: [contract] };
      }
      if (/INSERT INTO tasks/i.test(compact)) {
        if (failTaskInsert) throw new Error('task insert failed');
        return {
          rows: [{
            id: 'task-1',
            payload: JSON.parse(params[9]),
          }],
        };
      }
      if (/INSERT INTO work_routing_receipts/i.test(compact)) {
        return { rows: [{ id: 'receipt-1' }] };
      }
      if (/UPDATE tasks SET payload = payload \|\|/i.test(compact)) {
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE golden_paths/i.test(compact)) {
        return { rows: [{ id: 'gp-1', status: 'approved' }] };
      }
      if (/UPDATE pending_actions/i.test(compact)) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${compact}`);
    }),
  };
  return { client, sqlLog };
}

describe('sign_golden_path_contract pending action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the pending-action transaction client for signature and launch', async () => {
    const { client, sqlLog } = makeSigningClient();
    pool.connect.mockResolvedValueOnce(client);

    const result = await approvePendingAction('action-sign-1', 'owner');

    expect(result).toMatchObject({
      success: true,
      execution_result: {
        task: {
          id: 'task-1',
          payload: {
            gp_contract_id: 'contract-1',
            gp_contract_version: 1,
            gp_contract_hash: 'a'.repeat(64),
          },
        },
      },
    });
    expect(sqlLog).toContain('BEGIN');
    expect(sqlLog).toContain('COMMIT');
    expect(sqlLog.some((sql) => /INSERT INTO decisions/i.test(sql))).toBe(true);
    expect(sqlLog.some((sql) => (
      /UPDATE pending_actions/i.test(sql) && /status = 'approved'/i.test(sql)
    ))).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back signature, task, and pending-action resolution together', async () => {
    const { client, sqlLog } = makeSigningClient({ failTaskInsert: true });
    pool.connect.mockResolvedValueOnce(client);

    const result = await approvePendingAction('action-sign-1', 'owner');

    expect(result).toMatchObject({
      success: false,
      error: 'task insert failed',
    });
    expect(sqlLog).toContain('ROLLBACK');
    expect(sqlLog).not.toContain('COMMIT');
    expect(sqlLog.some((sql) => /UPDATE pending_actions/i.test(sql))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('preserves the stale-contract code and HTTP status for the API layer', async () => {
    const { client, sqlLog } = makeSigningClient({ stale: true });
    pool.connect.mockResolvedValueOnce(client);

    const result = await approvePendingAction('action-sign-1', 'owner');

    expect(result).toMatchObject({
      success: false,
      code: 'GP_CONTRACT_STALE',
      status: 409,
    });
    expect(sqlLog).toContain('ROLLBACK');
    expect(sqlLog.some((sql) => /INSERT INTO decisions/i.test(sql))).toBe(false);
  });
});
