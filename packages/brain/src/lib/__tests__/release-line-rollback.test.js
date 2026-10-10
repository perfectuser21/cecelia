/** 发布线·退回（决策 de6dff5d 第 3 步）：开关、未迁移、出错都不抛；手动退回参数校验。真库行为见 release-line.pg.integration.test.js。 */
import { describe, it, expect, vi } from 'vitest';
import { onJudgmentRecorded, rollbackActivity, evaluateProductionFailures } from '../release-line-rollback.js';

const quiet = { warn: vi.fn(), info: vi.fn() };

describe('onJudgmentRecorded fail-safe', () => {
  it('RELEASE_LINE_AUTO_ROLLBACK=off → 不查库', async () => {
    const db = { query: vi.fn() };
    expect(await onJudgmentRecorded(db, 'a', {}, { env: { RELEASE_LINE_AUTO_ROLLBACK: 'off' } })).toEqual({ action: 'off' });
    expect(db.query).not.toHaveBeenCalled();
  });
  it('非自动裁判 → 不评估；没跑迁移 541 → 跳过', async () => {
    expect(await onJudgmentRecorded({ query: vi.fn() }, 'a', { trigger_kind: 'manual' }, { env: {} })).toEqual({ action: 'not_auto' });
    const db = { query: vi.fn(async () => ({ rows: [{ ok: false }] })) };
    expect(await onJudgmentRecorded(db, 'a', {}, { env: {} })).toEqual({ action: 'not_migrated' });
  });
  it('查库出错 → 返回 error，不抛', async () => {
    const db = { query: vi.fn(async () => { throw new Error('db down'); }) };
    expect(await onJudgmentRecorded(db, 'a', {}, { env: {}, log: quiet })).toMatchObject({ action: 'error', error: 'db down' });
  });
});

describe('evaluateProductionFailures：取触发运行、按 run_id 去重、只认纯属生产版的运行', () => {
  it('同一失败运行被两条裁判算到只算一次；混了别的版本的运行不算', async () => {
    const report = (trigger, green, versions) => ({ runs: [{ run_id: 'latest', green: true }, { run_id: trigger, green }], run_version_ids: { [trigger]: versions } });
    const db = { query: vi.fn(async (sql) => {
      if (/activity_version_builds/.test(sql)) return { rows: [{ build_id: 'b1' }, { build_id: 'b2' }] };
      return { rows: [
        { id: 5, trigger_ref: 'r3', report: report('r3', false, ['b1']) },
        { id: 4, trigger_ref: 'r3', report: report('r3', false, ['b1']) },
        { id: 3, trigger_ref: 'r2', report: report('r2', false, ['b2', 'other']) },
        { id: 2, trigger_ref: 'r1', report: report('r1', false, ['b2']) },
        { id: 1, trigger_ref: 'r0', report: report('r0', false, ['b1']) },
      ] };
    }) };
    const out = await evaluateProductionFailures(db, 'a', 'v', 3);
    expect(out.runs.map(r => r.run_id)).toEqual(['r3', 'r1', 'r0']);
    expect(out.failing).toBe(true);
    const two = await evaluateProductionFailures(db, 'a', 'v', 4);
    expect(two.failing).toBe(false);
  });
});

describe('rollbackActivity 参数校验', () => {
  it('缺 actor / reason → 400，不开事务', async () => {
    const db = { query: vi.fn(), connect: vi.fn() };
    await expect(rollbackActivity(db, 'a', { reason: 'x' })).rejects.toMatchObject({ status: 400, code: 'ACTOR_REQUIRED' });
    await expect(rollbackActivity(db, 'a', { actor: 'x' })).rejects.toMatchObject({ status: 400, code: 'REASON_REQUIRED' });
    expect(db.connect).not.toHaveBeenCalled();
  });
});
