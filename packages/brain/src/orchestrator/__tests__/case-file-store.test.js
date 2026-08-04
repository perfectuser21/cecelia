/**
 * case-file-store.test.js —— gan_case_file 读写薄层单测（fake client/pool，不测真库）。
 * 真库读写全链见 src/__tests__/integration/gan-case-file.pg.integration.test.js。
 */
import { describe, it, expect, vi } from 'vitest';
import { insertCaseFileRow, loadCaseFile } from '../case-file-store.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const SHA = 'a'.repeat(40);

describe('insertCaseFileRow', () => {
  it('单 INSERT，blockers 默认 []，ON CONFLICT (run_id,round,author_role) DO NOTHING', async () => {
    const client = { query: vi.fn().mockResolvedValue({}) };

    await insertCaseFileRow(client, {
      runId: RUN_ID,
      round: 2,
      authorRole: 'reviewer',
      attemptId: ATTEMPT_ID,
      contractSha: SHA,
      rubricScores: { correctness: 8, coverage: 7 },
      blockers: [{ id: 'R2-1', dimension: 'correctness', status: 'open' }],
      feedbackMd: '# Round 2 review\n...',
    });

    expect(client.query).toHaveBeenCalledOnce();
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO gan_case_file/);
    expect(sql).toMatch(
      /ON CONFLICT \(run_id, round, author_role\) DO NOTHING/,
    );
    expect(params[0]).toBe(RUN_ID);
    expect(params[1]).toBe(2);
    expect(params[2]).toBe('reviewer');
    expect(params[3]).toBe(ATTEMPT_ID);
    expect(params[4]).toBe(SHA);
    expect(JSON.parse(params[5])).toEqual({ correctness: 8, coverage: 7 });
    expect(JSON.parse(params[6])).toEqual([
      { id: 'R2-1', dimension: 'correctness', status: 'open' },
    ]);
    expect(params[7]).toBe('# Round 2 review\n...');
  });

  it('blockers/rubricScores/contractSha/feedbackMd 缺省时落 []/null', async () => {
    const client = { query: vi.fn().mockResolvedValue({}) };

    await insertCaseFileRow(client, {
      runId: RUN_ID,
      round: 1,
      authorRole: 'proposer',
      attemptId: ATTEMPT_ID,
    });

    const [, params] = client.query.mock.calls[0];
    expect(params[4]).toBeNull();
    expect(params[5]).toBeNull();
    expect(JSON.parse(params[6])).toEqual([]);
    expect(params[7]).toBeNull();
  });

  it('缺 runId/round/authorRole/attemptId 时 fail-fast，不发 query', async () => {
    const client = { query: vi.fn() };

    await expect(insertCaseFileRow(client, {
      runId: RUN_ID,
      round: null,
      authorRole: 'reviewer',
      attemptId: ATTEMPT_ID,
    })).rejects.toThrow(/insertCaseFileRow requires/);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('loadCaseFile', () => {
  it('按 run_id 全量读回，SQL 按 round,author_role 升序排序', async () => {
    const rows = [
      { id: 'a', run_id: RUN_ID, round: 1, author_role: 'proposer' },
      { id: 'b', run_id: RUN_ID, round: 1, author_role: 'reviewer' },
    ];
    const pool = { query: vi.fn().mockResolvedValue({ rows }) };

    await expect(loadCaseFile(pool, RUN_ID)).resolves.toEqual(rows);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/FROM gan_case_file/);
    expect(sql).toMatch(/WHERE run_id\s*=\s*\$1/);
    expect(sql).toMatch(/ORDER BY round ASC, author_role ASC/);
    expect(params).toEqual([RUN_ID]);
  });
});
