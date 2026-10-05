/**
 * 契约 Step → Brain steps 行（树+仓库 v3.0 第 4 刀，路 A）：
 * 合同里每个 Step 的读回写在 dod.readback，模式写在 dod.mode；此前同步只认 step.readback，
 * 结果获客线 44 步的 readback 在 Brain 里全是 {}。这里锁住映射，并把「不写读回不许过」做成硬闸。
 */
import { describe, it, expect } from 'vitest';
import { declareStepsFromContract, assertStepsHaveReadback } from '../lib/contract-steps.js';

const step = (over = {}) => ({
  key: 'acquire_device_lock', name: '拿设备锁', order: 1, reads: ['Device.serial'], writes: ['Device.lock_holder'],
  check: 'lock-acquire rc=0 且锁文件 owner=本 run', implementation: { status: 'implemented', ref: 'harvest-cron.sh preflight_lock_acquire' },
  uses_llm: false, dod: { mode: 'checkpoint', readback: { type: 'metric', ref: 'metrics.lock_acquired', expect: { op: '==', value: 1 } } },
  ...over,
});
const activity = (steps) => ({ key: 'preflight', name: '预检', from: 'keyword_acquisition', steps });

describe('declareStepsFromContract', () => {
  it('读回取 dod.readback，模式取 dod.mode，名字/进出/动作按合同，规范 key = 能力.活动.步骤', () => {
    const [d] = declareStepsFromContract(activity([step()]), 'keyword_acquisition.preflight', []);
    expect(d).toMatchObject({
      key: 'keyword_acquisition.preflight.acquire_device_lock', activity: 'preflight', order: 1, mode: 'checkpoint',
      readback: { type: 'metric', ref: 'metrics.lock_acquired', expect: { op: '==', value: 1 } },
      name: '拿设备锁', action: 'harvest-cron.sh preflight_lock_acquire', inputs: ['Device.serial'], outputs: ['Device.lock_holder'],
    });
  });

  it('on_fail 只认合同显式声明且符合 retry:N|abort；没写不编造（null）', () => {
    expect(declareStepsFromContract(activity([step({ on_fail: 'retry:3' })]), 'k.a', [])[0].on_fail).toBe('retry:3');
    expect(declareStepsFromContract(activity([step({ on_fail: 'abort' })]), 'k.a', [])[0].on_fail).toBe('abort');
    expect(declareStepsFromContract(activity([step()]), 'k.a', [])[0].on_fail).toBeNull();
    expect(() => declareStepsFromContract(activity([step({ on_fail: 'maybe' })]), 'k.a', [])).toThrow(/on_fail/);
  });

  it('已有行用旧 key（不带前缀）时沿用旧 key，不另造一行', () => {
    const [d] = declareStepsFromContract(activity([step()]), 'keyword_acquisition.preflight', [{ id: 's1', key: 'acquire_device_lock' }]);
    expect(d.key).toBe('acquire_device_lock');
  });

  it('旧形状（step.readback / step.mode）仍可读；dod 优先', () => {
    const legacy = step({ dod: undefined, readback: { type: 'log', regex: 'x' }, mode: 'hard' });
    expect(declareStepsFromContract(activity([legacy]), 'k.a', [])[0]).toMatchObject({ mode: 'hard', readback: { type: 'log', regex: 'x' } });
  });

  it('缺稳定 key / 规范身份不唯一 → 抛错', () => {
    expect(() => declareStepsFromContract(activity([step({ key: '' })]), 'k.a', [])).toThrow(/稳定key/);
    expect(() => declareStepsFromContract(activity([step()]), 'k.a', [{ id: '1', key: 'acquire_device_lock' }, { id: '2', key: 'k.a.acquire_device_lock' }])).toThrow(/不唯一/);
  });
});

describe('assertStepsHaveReadback：不写读回不许过', () => {
  it('有 dod.readback（含 type=none 带原因）通过', () => {
    expect(() => assertStepsHaveReadback([activity([step(), step({ key: 'b', dod: { mode: 'checkpoint', reason: '确实读不回：人工目视确认', readback: { type: 'none' } } })])])).not.toThrow();
  });
  it('缺 dod、readback 为空对象、type=none 无原因：一次列出全部缺口并抛错', () => {
    const acts = [activity([
      step({ key: 'no_dod', dod: undefined }),
      step({ key: 'empty', dod: { mode: 'checkpoint', readback: {} } }),
      step({ key: 'none_no_reason', dod: { mode: 'checkpoint', readback: { type: 'none' } } }),
      step(),
    ])];
    let message = '';
    try { assertStepsHaveReadback(acts); } catch (e) { message = e.message; }
    expect(message).toMatch(/step_readback_missing/);
    for (const k of ['no_dod', 'empty', 'none_no_reason']) expect(message).toContain(`keyword_acquisition.preflight.${k}`);
    expect(message).not.toContain('acquire_device_lock');
  });
  it('没有 steps 的活动不在此闸管辖（活动级缺步骤由别处报）', () => {
    expect(() => assertStepsHaveReadback([{ key: 'x', from: 'c', steps: [] }, { key: 'y', from: 'c' }])).not.toThrow();
  });
});
