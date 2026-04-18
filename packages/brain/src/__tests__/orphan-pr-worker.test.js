/**
 * orphan-pr-worker.test.js — 孤儿 PR 兜底 worker 单元测试
 *
 * 注入 ghRunner + db mock，验证四类场景：
 *   - CI green + 无 in_progress task → merge
 *   - CI failed + 无 in_progress task → label needs-attention
 *   - 有关联 in_progress task → skip（不动作）
 *   - PR 年龄 < 2h → skip（不查 db，不动作）
 */
import { describe, it, expect, vi } from 'vitest';
import { runOrphanPrWorker, summarizeCiStatus } from '../orphan-pr-worker.js';

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function mkPR(overrides = {}) {
  return {
    number: 1,
    headRefName: 'cp-test',
    createdAt: new Date(NOW - 3 * HOUR).toISOString(),
    labels: [],
    statusCheckRollup: [{ conclusion: 'SUCCESS' }],
    ...overrides,
  };
}

function mkDb(rowCount = 0) {
  return {
    query: vi.fn().mockResolvedValue({
      rowCount,
      rows: rowCount > 0 ? [{ exists: 1 }] : [],
    }),
  };
}

function mkGh(prList, calls = []) {
  return vi.fn(async (cmd) => {
    calls.push(cmd);
    if (cmd.startsWith('gh pr list')) {
      return { stdout: JSON.stringify(prList), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  });
}

describe('summarizeCiStatus', () => {
  it('empty rollup → pending', () => {
    expect(summarizeCiStatus([])).toBe('pending');
    expect(summarizeCiStatus(undefined)).toBe('pending');
  });
  it('all success → success', () => {
    expect(summarizeCiStatus([{ conclusion: 'SUCCESS' }, { conclusion: 'SUCCESS' }])).toBe('success');
  });
  it('any failure → failure', () => {
    expect(summarizeCiStatus([{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }])).toBe('failure');
  });
  it('pending alongside success → pending', () => {
    expect(summarizeCiStatus([{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }])).toBe('pending');
  });
});

describe('runOrphanPrWorker', () => {
  it('CI green + no in_progress task → merges', async () => {
    const prs = [mkPR({ number: 42 })];
    const calls = [];
    const gh = mkGh(prs, calls);
    const db = mkDb(0);
    const r = await runOrphanPrWorker({ db, ghRunner: gh, now: NOW });
    expect(r.merged).toBe(1);
    expect(r.labeled).toBe(0);
    expect(calls.some((c) => c.includes('gh pr merge 42 --squash --delete-branch'))).toBe(true);
    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['cp-test']);
  });

  it('CI failed + no in_progress task → labels needs-attention', async () => {
    const prs = [mkPR({ number: 43, statusCheckRollup: [{ conclusion: 'FAILURE' }] })];
    const calls = [];
    const gh = mkGh(prs, calls);
    const db = mkDb(0);
    const r = await runOrphanPrWorker({ db, ghRunner: gh, now: NOW });
    expect(r.labeled).toBe(1);
    expect(r.merged).toBe(0);
    expect(calls.some((c) => c.includes('gh pr edit 43 --add-label needs-attention'))).toBe(true);
  });

  it('has in_progress task → skips without action', async () => {
    const prs = [mkPR({ number: 44 })];
    const calls = [];
    const gh = mkGh(prs, calls);
    const db = mkDb(1);
    const r = await runOrphanPrWorker({ db, ghRunner: gh, now: NOW });
    expect(r.merged).toBe(0);
    expect(r.labeled).toBe(0);
    expect(r.skipped).toBe(1);
    const postListCalls = calls.filter((c) => !c.startsWith('gh pr list'));
    expect(postListCalls.length).toBe(0);
  });

  it('PR too young (< 2h) → skips and does not query db', async () => {
    const prs = [mkPR({ number: 45, createdAt: new Date(NOW - 30 * 60 * 1000).toISOString() })];
    const calls = [];
    const gh = mkGh(prs, calls);
    const db = mkDb(0);
    const r = await runOrphanPrWorker({ db, ghRunner: gh, now: NOW });
    expect(r.merged).toBe(0);
    expect(r.skipped).toBe(1);
    expect(db.query).not.toHaveBeenCalled();
    const postListCalls = calls.filter((c) => !c.startsWith('gh pr list'));
    expect(postListCalls.length).toBe(0);
  });

  it('non-cp-* branch is not counted as scanned', async () => {
    const prs = [mkPR({ number: 46, headRefName: 'feature/other' })];
    const gh = mkGh(prs);
    const db = mkDb(0);
    const r = await runOrphanPrWorker({ db, ghRunner: gh, now: NOW });
    expect(r.scanned).toBe(0);
    expect(r.merged).toBe(0);
  });

  it('CI pending → skips without action', async () => {
    const prs = [mkPR({ number: 47, statusCheckRollup: [{ status: 'IN_PROGRESS' }] })];
    const calls = [];
    const gh = mkGh(prs, calls);
    const db = mkDb(0);
    const r = await runOrphanPrWorker({ db, ghRunner: gh, now: NOW });
    expect(r.skipped).toBe(1);
    expect(r.merged).toBe(0);
    expect(r.labeled).toBe(0);
  });

  it('already labeled needs-attention → does not re-label', async () => {
    const prs = [
      mkPR({
        number: 48,
        statusCheckRollup: [{ conclusion: 'FAILURE' }],
        labels: [{ name: 'needs-attention' }],
      }),
    ];
    const calls = [];
    const gh = mkGh(prs, calls);
    const db = mkDb(0);
    const r = await runOrphanPrWorker({ db, ghRunner: gh, now: NOW });
    expect(r.labeled).toBe(0);
    expect(r.skipped).toBe(1);
    const postListCalls = calls.filter((c) => !c.startsWith('gh pr list'));
    expect(postListCalls.length).toBe(0);
  });

  it('db error → conservative skip (no merge attempted)', async () => {
    const prs = [mkPR({ number: 49 })];
    const calls = [];
    const gh = mkGh(prs, calls);
    const db = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    const r = await runOrphanPrWorker({ db, ghRunner: gh, now: NOW });
    expect(r.merged).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].stage).toBe('db');
  });

  it('gh pr list failure → early return with error', async () => {
    const gh = vi.fn().mockRejectedValue(new Error('gh not authed'));
    const db = mkDb(0);
    const r = await runOrphanPrWorker({ db, ghRunner: gh, now: NOW });
    expect(r.scanned).toBe(0);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].stage).toBe('list');
  });

  it('dryRun=true counts would-be merges but does not invoke merge', async () => {
    const prs = [mkPR({ number: 50 })];
    const calls = [];
    const gh = mkGh(prs, calls);
    const db = mkDb(0);
    const r = await runOrphanPrWorker({ db, ghRunner: gh, now: NOW, dryRun: true });
    expect(r.merged).toBe(1);
    const postListCalls = calls.filter((c) => !c.startsWith('gh pr list'));
    expect(postListCalls.length).toBe(0);
  });
});
