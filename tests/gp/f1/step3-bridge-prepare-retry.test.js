/**
 * GP-Anchor: factory/F1 造完真验 #step3
 *
 * 第 32 批件①（issue 02c3e0ef，r58/r63/r64 三杀）：kernel remote-bridge prepare
 * 对 5xx/超时/网络失败零重试，一次瞬态 500 就 kernel_process_fatal 全 run 判死
 * （r58 瞬态、r63 运维手误、r64 磁盘写损伤 broken ref——浅层全是同一个裸 fatal）。
 *
 * 修复：prepare 有界重试（默认 3 次尝试，间隔可注入）——仅对
 * remote_bridge_prepare_http_5xx / _request_failed / _timeout 重试；
 * 409 conflict 与 4xx 语义错误不重试。
 */
import { describe, expect, it, vi } from 'vitest';
import { createRemoteBridgeTransport } from '../../../packages/brain/src/orchestrator/remote-bridge-transport.js';

const ATTEMPT = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  run_id: '22222222-2222-4222-8222-222222222222',
  lease_owner: 'host:1',
  lease_generation: 0,
  callbackSecret: 's'.repeat(32),
});
const TARGET = Object.freeze({ provider: 'claude', account: 'account2', machine: 'us-mac-m4' });
const BUNDLE = Object.freeze({ inputs: {}, role: 'generator', constraints: { timeout_seconds: 5400 } });

function makeTransport(fetchFn, extra = {}) {
  return createRemoteBridgeTransport({
    enabled: true,
    bridgeUrls: { 'us-mac-m4': 'http://127.0.0.1:5231' },
    sharedSecret: 'x'.repeat(64),
    brainUrl: 'http://127.0.0.1:5221',
    fetchFn,
    prepareTimeoutMs: 2000,
    prepareRetryDelayMs: 1,
    sleepFn: async () => {},
    ...extra,
  });
}

describe('bridge prepare 有界重试（r58/r63/r64 三杀）', () => {
  it('连续 5xx → 重试满 3 次后抛 http_500（fetch 被调 3 次，不再一击 fatal）', async () => {
    const fetchFn = vi.fn(async () => ({ status: 500, text: async () => 'boom' }));
    const transport = makeTransport(fetchFn);
    await expect(
      transport.prepare({ attempt: ATTEMPT, bundle: BUNDLE, spec: {}, target: TARGET }),
    ).rejects.toThrow(/remote_bridge_prepare_http_500/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('负向：409 conflict 不重试（语义错误，fetch 只调 1 次）', async () => {
    const fetchFn = vi.fn(async () => ({ status: 409, text: async () => 'conflict' }));
    const transport = makeTransport(fetchFn);
    await expect(
      transport.prepare({ attempt: ATTEMPT, bundle: BUNDLE, spec: {}, target: TARGET }),
    ).rejects.toThrow(/remote_bridge_prepare_conflict/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('负向：404 等 4xx 不重试', async () => {
    const fetchFn = vi.fn(async () => ({ status: 404, text: async () => 'nf' }));
    const transport = makeTransport(fetchFn);
    await expect(
      transport.prepare({ attempt: ATTEMPT, bundle: BUNDLE, spec: {}, target: TARGET }),
    ).rejects.toThrow(/remote_bridge_prepare_http_404/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('网络层失败（fetch throw）同样有界重试', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const transport = makeTransport(fetchFn);
    await expect(
      transport.prepare({ attempt: ATTEMPT, bundle: BUNDLE, spec: {}, target: TARGET }),
    ).rejects.toThrow(/remote_bridge_prepare_request_failed/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
