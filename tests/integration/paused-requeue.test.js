/**
 * Integration test: paused-requeuer — paused 任务重排 / 归档
 *
 * DoD 覆盖：
 *   [BEHAVIOR] paused>1h + retry<3 → requeued（status='queued', retry_count++）
 *   [BEHAVIOR] paused + retry>=3 → archived（status='archived'）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/brain/src/db.js', () => ({ default: {} }));

import { runPausedRequeue } from '../../packages/brain/src/paused-requeuer.js';

const T1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const T2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const T3 = 'aaaaaaaa-0000-0000-0000-000000000003';

function makePool(calls) {
  const queryMock = vi.fn();
  for (const val of calls) {
    queryMock.mockResolvedValueOnce(val);
  }
  return { query: queryMock };
}

describe('runPausedRequeue — paused 任务重排 / 归档', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── [BEHAVIOR] paused>1h + retry<3 → requeued ────────────────────────────

  it('paused>1h + retry<3 → status 改 queued，retry_count++', async () => {
    const pool = makePool([
      // archive query → 0 rows
      { rowCount: 0, rows: [] },
      // requeue query → 2 rows updated
      { rowCount: 2, rows: [{ id: T1 }, { id: T2 }] },
    ]);

    const r = await runPausedRequeue(pool);
    expect(r.requeued).toBe(2);
    expect(r.archived).toBe(0);

    const requeueCall = pool.query.mock.calls[1];
    expect(requeueCall[0]).toContain("status = 'queued'");
    expect(requeueCall[0]).toContain('retry_count');
    expect(requeueCall[0]).toContain("status = 'paused'");
    expect(requeueCall[0]).toContain('60 minutes');
    // retry_count < MAX（防越界）
    expect(requeueCall[0]).toContain('< $1');
    expect(requeueCall[1]).toEqual([3]);
  });

  it('paused<1h 的任务不被 requeue（由 SQL 时间条件保证）', async () => {
    const pool = makePool([
      { rowCount: 0, rows: [] }, // archive → 0
      { rowCount: 0, rows: [] }, // requeue → 0（DB 端时间过滤）
    ]);

    const r = await runPausedRequeue(pool);
    expect(r.requeued).toBe(0);
    expect(r.archived).toBe(0);

    // 确认 SQL 包含 60 minutes 阈值
    const requeueSql = pool.query.mock.calls[1][0];
    expect(requeueSql).toContain('60 minutes');
  });

  it('单个 paused>1h+retry=0 任务 → requeued=1', async () => {
    const pool = makePool([
      { rowCount: 0, rows: [] },
      { rowCount: 1, rows: [{ id: T1 }] },
    ]);

    const r = await runPausedRequeue(pool);
    expect(r.requeued).toBe(1);
    expect(r.archived).toBe(0);
  });

  // ─── [BEHAVIOR] paused + retry>=3 → archived ──────────────────────────────

  it('paused + retry>=3 → status 改 archived', async () => {
    const pool = makePool([
      // archive query → 1 row
      { rowCount: 1, rows: [{ id: T3 }] },
      // requeue query → 0 rows
      { rowCount: 0, rows: [] },
    ]);

    const r = await runPausedRequeue(pool);
    expect(r.archived).toBe(1);
    expect(r.requeued).toBe(0);

    const archiveCall = pool.query.mock.calls[0];
    expect(archiveCall[0]).toContain("status = 'archived'");
    expect(archiveCall[0]).toContain("status = 'paused'");
    expect(archiveCall[0]).toContain('>= $1');
    expect(archiveCall[1]).toEqual([3]);
  });

  it('多个 retry>=3 的 paused 任务 → 全部 archived', async () => {
    const pool = makePool([
      { rowCount: 3, rows: [{ id: T1 }, { id: T2 }, { id: T3 }] },
      { rowCount: 0, rows: [] },
    ]);

    const r = await runPausedRequeue(pool);
    expect(r.archived).toBe(3);
  });

  // ─── 混合场景 + 归档优先 ────────────────────────────────────────────────────

  it('archive 先执行：retry>=3 先归档，不会被 requeue 捕捉', async () => {
    const pool = makePool([
      { rowCount: 2, rows: [{ id: T2 }, { id: T3 }] }, // archive
      { rowCount: 1, rows: [{ id: T1 }] },              // requeue
    ]);

    const r = await runPausedRequeue(pool);
    expect(r.archived).toBe(2);
    expect(r.requeued).toBe(1);

    // archive SQL 在 requeue SQL 之前被调用
    const archiveSql = pool.query.mock.calls[0][0];
    const requeueSql = pool.query.mock.calls[1][0];
    expect(archiveSql).toContain("'archived'");
    expect(requeueSql).toContain("'queued'");
  });

  // ─── 错误安全 ──────────────────────────────────────────────────────────────

  it('pool.query 抛异常 → 错误向上传播（调用方负责捕获）', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('db connection refused')),
    };
    await expect(runPausedRequeue(pool)).rejects.toThrow('db connection refused');
  });
});
