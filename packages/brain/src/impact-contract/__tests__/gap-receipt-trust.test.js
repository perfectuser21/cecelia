import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { transitionGapStatus } from '../gap-store.js';

const REVISION = 'a'.repeat(40);
const ASSERTION_ID = 'assertion-1';
const ASSERTION_DIGEST = createHash('sha256').update(ASSERTION_ID).digest('hex');
const LINK_ID = '11111111-1111-4111-8111-111111111111';
const CONTRACT_ID = '22222222-2222-4222-8222-222222222222';
const CONTRACT_HASH = 'c'.repeat(64);
const COMPLETED_AT = '2026-08-11T04:00:00.000Z';

function resolutionDb(receiptOverrides = {}) {
  return {
    query: vi.fn(async (sql) => {
      const statement = String(sql);
      if (statement.startsWith('SELECT * FROM harness_gaps')) {
        return { rows: [{
          id: 'gap',
          source_task_id: 'source-task',
          repair_task_id: 'repair-task',
          impact_node_id: 'billing',
          status: 'verifying',
          current_revision: REVISION,
        }] };
      }
      if (statement.startsWith('SELECT id FROM tasks')) return { rows: [{ id: 'source-task' }] };
      if (statement.startsWith('SELECT status, completed_at FROM tasks')) {
        return { rows: [{ status: 'completed', completed_at: COMPLETED_AT }] };
      }
      if (statement.includes('FROM harness_impact_contracts')) {
        return { rows: [{
          id: CONTRACT_ID,
          contract_hash: CONTRACT_HASH,
          repo: 'perfectuser21/cecelia',
          contract_body: { required_assertions: [{
            assertion_id: ASSERTION_ID,
            command: 'npm test',
            covers_capability_ids: ['billing'],
            journey_step_link_id: LINK_ID,
            assertion_revision: 1,
            assertion_digest: ASSERTION_DIGEST,
          }] },
        }] };
      }
      if (statement.includes('MAX(created_at) AS verification_started_at')) {
        return { rows: [{ verification_started_at: COMPLETED_AT }] };
      }
      if (statement.includes('FROM journey_assertion_receipts')) {
        return { rows: [{
          id: 'receipt-1',
          journey_step_link_id: LINK_ID,
          verdict: 'PASS',
          exit_code: 0,
          synthetic: false,
          executor_kind: 'brain_assertion_runner',
          source_repo: 'perfectuser21/cecelia',
          source_sha: REVISION,
          impact_contract_id: CONTRACT_ID,
          impact_contract_hash: CONTRACT_HASH,
          verification_task_id: 'repair-task',
          machine_id: 'runner-1',
          assertion_ref_snapshot: ASSERTION_ID,
          current_assertion_ref: ASSERTION_ID,
          assertion_revision: 1,
          current_assertion_revision: 1,
          assertion_digest: ASSERTION_DIGEST,
          command_argv: ['bash', '-lc', 'npm test'],
          completed_at: '2026-08-11T04:01:00.000Z',
          output_digest: 'b'.repeat(64),
          scenario_count: 1,
          scenario_evidence: { passed: 1 },
          ...receiptOverrides,
        }] };
      }
      return { rows: [] };
    }),
  };
}

async function resolveWith(db) {
  return transitionGapStatus(db, 'gap', 'resolved', {
    resolutionEvidence: {
      assertion_id: ASSERTION_ID,
      receipt_id: 'receipt-1',
      revision: REVISION,
    },
  });
}

describe('Gap resolution 不可变回执信任边界', () => {
  it('拒绝缺少 machine_id 的 PASS 回执', async () => {
    await expect(resolveWith(resolutionDb({ machine_id: null })))
      .rejects.toMatchObject({ code: 'invalid_resolution_evidence' });
  });

  it('拒绝来自其他仓库的 PASS 回执', async () => {
    await expect(resolveWith(resolutionDb({ source_repo: 'other/repo' })))
      .rejects.toMatchObject({ code: 'invalid_resolution_evidence' });
  });

  it('拒绝 verification_started 前的旧 PASS 回执', async () => {
    await expect(resolveWith(resolutionDb({ completed_at: '2026-08-11T03:59:59.000Z' })))
      .rejects.toMatchObject({ code: 'invalid_resolution_evidence' });
  });

  it('拒绝未执行合同命令的 PASS 回执', async () => {
    await expect(resolveWith(resolutionDb({ command_argv: ['bash', '-lc', 'true'] })))
      .rejects.toMatchObject({ code: 'invalid_resolution_evidence' });
  });
});
