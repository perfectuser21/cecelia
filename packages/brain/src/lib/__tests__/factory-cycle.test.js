/** 技能工厂一轮（任务 a5f42455 / 2231ecc0）：开关、动作落库、在途不刷 next_action、tick 接线。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../factory-ledger.js', async (orig) => {
  const real = await orig();
  return {
    ...real,
    listLedger: vi.fn(), transitionLedger: vi.fn(async () => ({})), patchLedger: vi.fn(async () => ({})),
    recordRun: vi.fn(async () => ({ duplicate: false })), resetLedgerWindow: vi.fn(async () => ({})),
  };
});
const ledgerLib = await import('../factory-ledger.js');
const { runFactoryCycle, runFactoryPusher, isFactoryPusherEnabled } = await import('../factory-cycle.js');
const { resolveWorkflowConfig } = await import('../factory-workflow-config.js');

const DAY = () => new Date('2026-10-11T06:00:00Z');
const LEDGER = {
  id: '1b5a0be0-f0b2-4960-af44-f09790a039c1', workflow_key: 'douyin_video_publish.android', workflow_name: '抖音', stage: 3,
  validation_mode: 'use_while_validate', window_k: 3, recent_runs: [], recent_pass: 0, recent_total: 0,
  candidate_version: 'android-douyin-private-video@1.0.8', blocked_kind: 'none', next_action: null, stage_changed_at: '2026-10-11T09:00:00Z',
};
const store = (over = {}) => ({
  listLedgers: vi.fn(async () => [LEDGER]), inFlight: vi.fn(async () => null), countRounds: vi.fn(async () => 0),
  consecutiveFails: vi.fn(async () => 0), tickets: vi.fn(async () => ({ done: 0, total: 0 })), ...over,
});
const db = (configValue) => ({ query: vi.fn(async () => ({ rows: configValue === undefined ? [] : [{ value: configValue }] })) });

beforeEach(() => vi.clearAllMocks());

describe('开关', () => {
  it('默认开；环境变量或 brain_config 设 false 即关', async () => {
    expect(await isFactoryPusherEnabled(db(), {})).toBe(true);
    expect(await isFactoryPusherEnabled(db(), { FACTORY_PUSHER_ENABLED: 'false' })).toBe(false);
    expect(await isFactoryPusherEnabled(db('false'), {})).toBe(false);
    expect(await isFactoryPusherEnabled(db('true'), {})).toBe(true);
  });
  it('关闭时整轮跳过，不裁判不建单', async () => {
    const createTask = vi.fn();
    const out = await runFactoryCycle(db(), { env: { FACTORY_PUSHER_ENABLED: 'false' }, createTask });
    expect(out).toEqual({ skipped: 'disabled' });
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe('runFactoryPusher 动作落库', () => {
  it('建 stage 3 执行单并把任务 id 写进 next_action', async () => {
    const createTask = vi.fn(async () => ({ task: { id: 'cccccccc-1111-4222-8333-444444444444' } }));
    const out = await runFactoryPusher({}, { store: store(), createTask, resolveConfig: resolveWorkflowConfig, now: DAY });
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0][0].payload.factory.round).toBe(1);
    expect(out[0].actions).toEqual([{ type: 'dispatch', task_id: 'cccccccc-1111-4222-8333-444444444444' }]);
    expect(ledgerLib.patchLedger).toHaveBeenCalledWith({}, LEDGER.id, { next_action: expect.stringContaining('cccccccc-1111-4222-8333-444444444444') });
  });
  it('在途且 next_action 已记该单 → 不刷 next_action、不建单', async () => {
    const s = store({ listLedgers: vi.fn(async () => [{ ...LEDGER, next_action: '[推进器] 已建 … t1 …' }]), inFlight: vi.fn(async () => ({ id: 't1', status: 'queued' })) });
    const createTask = vi.fn();
    await runFactoryPusher({}, { store: s, createTask, resolveConfig: resolveWorkflowConfig, now: DAY });
    expect(createTask).not.toHaveBeenCalled();
    expect(ledgerLib.patchLedger).not.toHaveBeenCalled();
  });
  it('滑窗全过 → transitionLedger(actor=rule, expected_from_stage)', async () => {
    const full = { ...LEDGER, recent_runs: [{ run_id: 'a', pass: true }, { run_id: 'b', pass: true }, { run_id: 'c', pass: true }], recent_pass: 3, recent_total: 3 };
    await runFactoryPusher({}, { store: store({ listLedgers: vi.fn(async () => [full]) }), createTask: vi.fn(), resolveConfig: resolveWorkflowConfig, now: DAY });
    expect(ledgerLib.transitionLedger).toHaveBeenCalledWith({}, LEDGER.id, expect.objectContaining({ to_stage: 4, actor: 'rule', expected_from_stage: 3, evidence_run_ids: ['a', 'b', 'c'] }));
  });
  it('卡点 409 不越过：transition 被拒时记错误、不建单，其余行继续', async () => {
    ledgerLib.transitionLedger.mockRejectedValueOnce(Object.assign(new Error('blocked'), { status: 409, code: 'BLOCKED_NEEDS_HUMAN' }));
    const full = { ...LEDGER, recent_runs: [{ run_id: 'a', pass: true }, { run_id: 'b', pass: true }, { run_id: 'c', pass: true }], recent_pass: 3, recent_total: 3 };
    const other = { ...LEDGER, id: '2b5a0be0-f0b2-4960-af44-f09790a039c1' };
    const createTask = vi.fn(async () => ({ task: { id: 'dddddddd-1111-4222-8333-444444444444' } }));
    const out = await runFactoryPusher({}, { store: store({ listLedgers: vi.fn(async () => [full, other]) }), createTask, resolveConfig: resolveWorkflowConfig, now: DAY, log: () => {} });
    expect(out[0]).toMatchObject({ code: 'BLOCKED_NEEDS_HUMAN' });
    expect(out[1].actions[0].type).toBe('dispatch');
  });
  it('滑窗 fail → resetLedgerWindow 再建单', async () => {
    const f = { ...LEDGER, recent_runs: [{ run_id: 'x', pass: false }], recent_pass: 0, recent_total: 1 };
    const createTask = vi.fn(async () => ({ task: { id: 'eeeeeeee-1111-4222-8333-444444444444' } }));
    await runFactoryPusher({}, { store: store({ listLedgers: vi.fn(async () => [f]), consecutiveFails: vi.fn(async () => 1) }), createTask, resolveConfig: resolveWorkflowConfig, now: DAY });
    expect(ledgerLib.resetLedgerWindow).toHaveBeenCalledWith({}, LEDGER.id, expect.objectContaining({ expectedStage: 3, evidenceRunIds: ['x'] }));
    expect(createTask).toHaveBeenCalledTimes(1);
  });
});

describe('调度接线（executeTick 自 Wave 2 起不被调用，必须挂 scheduler-jobs）', () => {
  it('scheduler-jobs 登记 factory-cycle job（5 分钟声明间隔）并调用 runFactoryCycle(pool)', () => {
    const src = readFileSync(fileURLToPath(new URL('../../scheduler-jobs.js', import.meta.url)), 'utf8');
    expect(src).toMatch(/import \{ runFactoryCycle \} from '\.\/lib\/factory-cycle\.js'/);
    expect(src).toMatch(/name: 'factory-cycle', cadence: \{ everySec: 300 \}[^\n]*runFactoryCycle\(pool\)/);
  });
  it('tick-runner 不再挂 factory-cycle（死路径，避免双跑）', () => {
    const src = readFileSync(fileURLToPath(new URL('../../tick-runner.js', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/runFactoryCycle/);
  });
  it('调度器每 60s 全调：runFactoryCycle 自 gate，间隔内第二次返回 throttled，force 可越过', async () => {
    const t0 = Date.now() + 10 * 3600 * 1000;
    const env = { FACTORY_PUSHER_ENABLED: 'false' };
    expect(await runFactoryCycle(db(), { env, now: () => new Date(t0) })).toEqual({ skipped: 'disabled' });
    expect(await runFactoryCycle(db(), { env, now: () => new Date(t0 + 60_000) })).toEqual({ skipped: 'throttled' });
    expect(await runFactoryCycle(db(), { env, now: () => new Date(t0 + 60_000), force: true })).toEqual({ skipped: 'disabled' });
    expect(await runFactoryCycle(db(), { env, now: () => new Date(t0 + 60_000 + 301_000) })).toEqual({ skipped: 'disabled' });
  });
});
