/**
 * 发布线（决策 de6dff5d 第 3 步）纯函数与 fail-safe 外壳：开关默认值、接口判定、同步挂钩 SAVEPOINT fail-open、
 * 发布时把关默认关零查询、自动退回钩子不影响裁判。
 */
import { describe, it, expect, vi } from 'vitest';
import { releaseLineFlags, runReleaseLineHook, releaseLineGapsForRelease } from '../release-line.js';
import { judgeActivity } from '../activity-judge.js';

const fakeClient = (fail = {}) => {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql) => {
      calls.push(sql);
      for (const [re, err] of Object.entries(fail)) if (new RegExp(re).test(sql)) throw new Error(err);
      if (/to_regclass/.test(sql)) return { rows: [{ ok: true }] };
      return { rows: [], rowCount: 0 };
    }),
  };
};
const quiet = { warn: vi.fn(), info: vi.fn() };

describe('开关默认值（今天行为不变）', () => {
  it('同步挂钩开、保护影子、自动退回 advisory、发布把关关、退回阈值 3、晋级 5 绿', () => {
    expect(releaseLineFlags({})).toEqual({ syncHook: true, protect: false, autoRollback: 'advisory', enforceRelease: false, rollbackFailures: 3, requiredGreen: 5 });
    expect(releaseLineFlags({ RELEASE_LINE_SYNC_HOOK: 'off', RELEASE_LINE_PROTECT: 'on', RELEASE_LINE_AUTO_ROLLBACK: 'on', RELEASE_LINE_ENFORCE_RELEASE: 'on' }))
      .toMatchObject({ syncHook: false, protect: true, autoRollback: 'on', enforceRelease: true });
    expect(releaseLineFlags({ RELEASE_LINE_AUTO_ROLLBACK: 'weird', RELEASE_ROLLBACK_FAILURES: '0' })).toMatchObject({ autoRollback: 'advisory', rollbackFailures: 3 });
  });
});

describe('同步挂钩 fail-open', () => {
  it('fn 抛错 → ROLLBACK TO SAVEPOINT，不抛，发 P2', async () => {
    const db = fakeClient();
    const alert = vi.fn(async () => {});
    const out = await runReleaseLineHook(db, 'register_build', async () => { throw new Error('version_no 撞号'); }, { env: {}, alert, log: quiet });
    expect(out.error).toMatch(/撞号/);
    expect(db.calls).toEqual(expect.arrayContaining(['SAVEPOINT release_line_hook', 'ROLLBACK TO SAVEPOINT release_line_hook']));
    await new Promise(r => setTimeout(r, 0));
    expect(alert).toHaveBeenCalledWith('P2', 'release_line_sync_hook_failed', expect.stringContaining('register_build'));
  });
  it('事务没开（SAVEPOINT 报错）→ 只记日志不抛', async () => {
    const db = fakeClient({ SAVEPOINT: 'SAVEPOINT can only be used in transaction blocks' });
    const out = await runReleaseLineHook(db, 'x', vi.fn(), { env: {}, alert: vi.fn(), log: quiet });
    expect(out.error).toMatch(/transaction blocks/);
  });
  it('没跑迁移 541 → 跳过；开关 off → 不发任何查询', async () => {
    const db = { query: vi.fn(async (sql) => (/to_regclass/.test(sql) ? { rows: [{ ok: false }] } : { rows: [] })) };
    const fn = vi.fn();
    expect(await runReleaseLineHook(db, 'x', fn, { env: {} })).toEqual({ skipped: 'not_migrated' });
    expect(fn).not.toHaveBeenCalled();
    const off = { query: vi.fn() };
    expect(await runReleaseLineHook(off, 'x', fn, { env: { RELEASE_LINE_SYNC_HOOK: 'off' } })).toEqual({ skipped: 'disabled' });
    expect(off.query).not.toHaveBeenCalled();
  });
});

describe('发布时把关', () => {
  it('默认关 → 零查询、无缺口（bootstrap 场景下不会挡部署）', async () => {
    const db = { query: vi.fn() };
    expect(await releaseLineGapsForRelease(db, 'production', [{ id: 'b', activity_id: 'a' }], { env: {} })).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });
  it('打开但查询出错 → 回滚到 savepoint、按无缺口放行', async () => {
    const db = fakeClient({ activity_release_state: 'boom' });
    const out = await releaseLineGapsForRelease(db, 'production', [{ id: 'b', activity_id: 'a' }], { env: { RELEASE_LINE_ENFORCE_RELEASE: 'on' }, log: quiet });
    expect(out).toEqual([]);
    expect(db.calls).toContain('ROLLBACK TO SAVEPOINT release_line_release_check');
  });
});

describe('自动退回钩子不影响裁判落库', () => {
  it('onRecorded 同步抛 / 异步拒绝 → judgeActivity 照常返回 judgment_id', async () => {
    const db = { totalCount: 0, query: vi.fn(async (sql) => (/INSERT INTO activity_judgments/.test(sql) ? { rows: [{ id: 7, judged_at: 'x' }] } : { rows: [] })) };
    const report = { verdict: 'diverged', converged: false, consecutive_green: 0, required_green: 5, runs: [{ run_id: 'r1', green: false, steps: [] }] };
    const calls = [];
    for (const onRecorded of [() => { calls.push(1); throw new Error('sync boom'); }, async () => { calls.push(2); throw new Error('async boom'); }]) {
      const out = await judgeActivity(db, 'a', { trigger: 'auto', triggerRef: 'r1', reconcile: async () => report, applyCell: async () => {}, onRecorded, log: quiet });
      expect(out.judgment_id).toBe(7);
    }
    await new Promise(r => setTimeout(r, 0));
    expect(calls).toEqual([1, 2]);
  });
  it('传单连接（可能在调用方事务里）→ 不评估退回', async () => {
    const db = { query: vi.fn(async (sql) => (/INSERT INTO activity_judgments/.test(sql) ? { rows: [{ id: 9 }] } : { rows: [] })) };
    const onRecorded = vi.fn();
    await judgeActivity(db, 'a', { trigger: 'auto', triggerRef: 'r1', reconcile: async () => ({ verdict: 'diverged', runs: [{ run_id: 'r1', steps: [] }] }), applyCell: async () => {}, onRecorded, log: quiet });
    await new Promise(r => setTimeout(r, 0));
    expect(onRecorded).not.toHaveBeenCalled();
  });
  it('裁判报告带 run_version_ids 与 window_unversioned_run_count（纯净窗口判定用）', async () => {
    const db = { query: vi.fn(async (sql) => {
      if (/INSERT INTO activity_judgments/.test(sql)) return { rows: [{ id: 8 }] };
      if (/SELECT DISTINCT run_id/.test(sql)) return { rows: [{ run_id: 'r1', version_id: 'b1' }] };
      if (/FROM spans/.test(sql)) return { rows: [{ version_id: 'b1' }] };
      return { rows: [] };
    }) };
    const report = { verdict: 'converging', converged: false, consecutive_green: 1, required_green: 5, runs: [{ run_id: 'r1', green: true }, { run_id: 'r0', green: true }] };
    await judgeActivity(db, 'a', { reconcile: async () => report });
    const ins = db.query.mock.calls.find(([sql]) => /INSERT INTO activity_judgments/.test(sql));
    const stored = JSON.parse(ins[1][9]);
    expect(stored.run_version_ids).toEqual({ r1: ['b1'] });
    expect(stored.window_unversioned_run_count).toBe(1);
  });
});
