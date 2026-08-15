import { describe, expect, it, vi } from 'vitest';
import { persistOneSessionJudgeReceipt } from '../one-session-judge-receipt.js';

const RUN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TASK_ID = '11111111-2222-4333-8444-555555555555';
const CONTRACT_ID = '22222222-3333-4444-8555-666666666666';
const IDENTITY = Object.freeze({
  contract_id: CONTRACT_ID,
  manifest_sha256: 'b'.repeat(64),
  source_revision: 'c'.repeat(40),
});

function makePool({ existing = false, failInsert = false } = {}) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql) => {
      calls.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM tasks')) return { rows: [{ id: TASK_ID }] };
      if (sql.includes('FROM initiative_runs')) {
        return { rows: [{ id: RUN_ID, contract_id: CONTRACT_ID }] };
      }
      if (sql.includes('FROM initiative_contract_artifact_seals')) {
        return { rows: [{
          contract_id: CONTRACT_ID,
          manifest_sha256: IDENTITY.manifest_sha256,
          source_revision: IDENTITY.source_revision,
        }] };
      }
      if (sql.includes("detail->>'source' = 'one_session_judge_api'")) {
        return existing ? { rows: [{ hop: 7 }] } : { rows: [] };
      }
      if (failInsert && sql.includes('INSERT INTO orchestrator_decision_log')) {
        throw new Error('decision_log_insert_failed');
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

function input() {
  return {
    runId: RUN_ID,
    taskId: TASK_ID,
    prHeadSha: 'a'.repeat(40),
    contractIdentity: IDENTITY,
    evaluatorVerdict: 'PASS',
    evaluatorFeedback: 'human acceptance complete',
    evaluatorEvidenceSha256: 'd'.repeat(64),
    judgeResult: {
      judged: true,
      verdict: 'PASS',
      feedback: 'independent judge accepted the evidence',
      failure_class: null,
      failure_signature: null,
      coverage: [{ step: 'save', passed: true, deferred: false, evidence: 'verified' }],
    },
  };
}

describe('persistOneSessionJudgeReceipt', () => {
  it('按 task→run→seal 锁序原子写 evaluator/judge exact authority', async () => {
    const { pool, calls, client } = makePool();
    const result = await persistOneSessionJudgeReceipt(pool, input());

    expect(result).toMatchObject({ persisted: true, contract_identity: IDENTITY });
    expect(calls.indexOf('BEGIN')).toBeLessThan(calls.findIndex((sql) => sql.includes('FROM tasks')));
    expect(calls.findIndex((sql) => sql.includes('FROM tasks')))
      .toBeLessThan(calls.findIndex((sql) => sql.includes('FROM initiative_runs')));
    expect(calls.findIndex((sql) => sql.includes('FROM initiative_runs')))
      .toBeLessThan(calls.findIndex((sql) => sql.includes('FROM initiative_contract_artifact_seals')));
    expect(calls.filter((sql) => sql.includes('INSERT INTO orchestrator_decision_log')))
      .toHaveLength(2);
    expect(calls.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('同一 run/head/contract 重试幂等，不追加第二组 receipt', async () => {
    const { pool, calls } = makePool({ existing: true });
    const result = await persistOneSessionJudgeReceipt(pool, input());
    expect(result).toMatchObject({ persisted: false, existing_hop: 7 });
    expect(calls.some((sql) => sql.includes('INSERT INTO orchestrator_decision_log'))).toBe(false);
  });

  it('任一 append 失败整体 ROLLBACK 且释放 client', async () => {
    const { pool, calls, client } = makePool({ failInsert: true });
    await expect(persistOneSessionJudgeReceipt(pool, input()))
      .rejects.toThrow('decision_log_insert_failed');
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('拒绝 stale contract identity，且不写 receipt', async () => {
    const { pool, calls } = makePool();
    await expect(persistOneSessionJudgeReceipt(pool, {
      ...input(),
      contractIdentity: { ...IDENTITY, manifest_sha256: 'e'.repeat(64) },
    })).rejects.toThrow('one_session_contract_identity_changed');
    expect(calls.some((sql) => sql.includes('INSERT INTO orchestrator_decision_log'))).toBe(false);
    expect(calls).toContain('ROLLBACK');
  });
});
