/**
 * FR-15 failing test — G2 部署漂移哨兵
 *
 * 先写规则（INV-04 + PRD 测试约束）：
 * - 本文件在 drift-sentinel.js 实现前必须 CI red
 * - 禁 mock isDrifted() 判定逻辑与 runDeploy() 调用之间的边
 * - 两端 SHA 差值和时间差由测试内部构造，不得绕过防抖逻辑
 *
 * 覆盖场景：
 *   FR-15-ok          : SHA 一致 → verdict=ok，deploy 不被调
 *   FR-15-debounce    : SHA 不等但未满 30min → verdict=drifting，deploy 不被调
 *   FR-15-redeploy    : SHA 不等且满 30min01s → verdict=redeploying，deploy 被调 1 次
 *   FR-15-network-err : 拉取 main SHA 失败 → verdict=network_error，deploy 不被调
 *   FR-15-prod-unreach: 拉取 prod SHA 失败 → verdict=prod_unreachable，deploy 不被调
 *   FR-15-escalate    : redeployCount>=2 且仍漂移 → verdict=escalated，deploy 不被调，sendBark 被调 1 次
 *   FR-15-boundary    : 边界：29min59s 不触发，30min01s 触发
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock 外部依赖（允许 mock 的边：对外部 I/O，不 mock 内部判定逻辑）
// ─────────────────────────────────────────────────────────────────────────────

// mock db（KV 存取）
const mockKvStore = new Map();
vi.mock('../../../packages/brain/src/db.js', () => ({
  default: {
    query: vi.fn(async (sql, params) => {
      // 简单 KV 模拟：scheduler_jobs 或 brain_kv 表
      if (sql.includes('SELECT') && sql.includes('drift_sentinel_state')) {
        const val = mockKvStore.get('drift_sentinel_state');
        return { rows: val ? [{ value: val }] : [] };
      }
      if (sql.includes('INSERT') || sql.includes('UPDATE')) {
        if (params && params[0] === 'drift_sentinel_state') {
          mockKvStore.set('drift_sentinel_state', params[1]);
        }
        return { rows: [] };
      }
      if (sql.includes('DELETE') && sql.includes('drift_sentinel_state')) {
        mockKvStore.delete('drift_sentinel_state');
        return { rows: [] };
      }
      return { rows: [] };
    }),
  },
}));

// mock alerting.js（raise 用于 P1 上报）
vi.mock('../../../packages/brain/src/alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(undefined),
}));

// mock notifier.js（sendBark）
const mockSendBark = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../packages/brain/src/notifier.js', () => ({
  sendBark: mockSendBark,
}));

// mock child_process（exec brain-deploy.sh）—— 只 mock I/O 边界，不 mock 判定逻辑
const mockExecDeploy = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    exec: vi.fn((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; }
      mockExecDeploy(cmd).then(
        (res) => cb && cb(null, res.stdout, res.stderr),
        (err) => cb && cb(err)
      );
    }),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// 关键：导入 drift-sentinel.js（本文件实现前此 import 会失败 → CI red）
// ─────────────────────────────────────────────────────────────────────────────
import {
  runDriftCheck,
  DRIFT_SENTINEL_INTERVAL_MS,
  DRIFT_WINDOW_MS,
} from '../../../packages/brain/src/cron/drift-sentinel.js';

// ─────────────────────────────────────────────────────────────────────────────
// 测试辅助：构造 SHA 拉取函数（替代真实网络调用，允许 mock 外部 I/O 边界）
// ─────────────────────────────────────────────────────────────────────────────

const SHA_MAIN = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
const SHA_PROD = 'ffff6666gggg7777hhhh8888iiii9999jjjj0000';
const SHA_SAME = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';

function makeOptions({
  mainSha = SHA_MAIN,
  prodSha = SHA_PROD,
  mainFails = false,
  prodFails = false,
  now = new Date(),
  redeployCount = 0,
  driftFirstSeenAt = null,
} = {}) {
  return {
    // 允许注入外部 I/O 函数（SHA 拉取），不 mock 判定逻辑
    fetchMainSha: mainFails
      ? async () => { throw new Error('network error'); }
      : async () => mainSha,
    fetchProdSha: prodFails
      ? async () => { throw new Error('connection refused'); }
      : async () => prodSha,
    // 注入当前时间（测试时间控制）
    now,
    // 注入初始 KV 状态（防抖时间戳和 redeployCount）
    _testInitialState: { redeployCount, driftFirstSeenAt },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('drift-sentinel — FR-15 contract tests', () => {
  beforeEach(() => {
    mockKvStore.clear();
    mockExecDeploy.mockClear();
    mockSendBark.mockClear();
    vi.mocked(await import('../../../packages/brain/src/alerting.js')).raise?.mockClear?.();
  });

  // FR-15-ok：SHA 一致 → verdict=ok，deploy 不被调
  it('FR-15-ok: SHA 一致时 verdict=ok，deploy 函数不被调', async () => {
    const result = await runDriftCheck(makeOptions({
      mainSha: SHA_SAME,
      prodSha: SHA_SAME,
      now: new Date(),
    }));

    expect(result.verdict).toBe('ok');
    expect(mockExecDeploy).not.toHaveBeenCalled();
  });

  // FR-15-debounce：SHA 不等但未满 30min → verdict=drifting
  it('FR-15-debounce: SHA 不等但 driftFirstSeenAt 未满 30min → verdict=drifting，deploy 不被调', async () => {
    const now = new Date('2026-07-16T10:00:00Z');
    // 首见时间 = 29min59s 前（不满 30min）
    const driftFirstSeenAt = new Date(now.getTime() - (30 * 60 * 1000 - 1000)).toISOString(); // 29min59s

    const result = await runDriftCheck(makeOptions({
      mainSha: SHA_MAIN,
      prodSha: SHA_PROD,
      now,
      driftFirstSeenAt,
    }));

    expect(result.verdict).toBe('drifting');
    expect(mockExecDeploy).not.toHaveBeenCalled();
  });

  // FR-15-redeploy：SHA 不等 + 满 30min01s → verdict=redeploying，deploy 被调 1 次
  it('FR-15-redeploy: SHA 不等且 driftFirstSeenAt 满 30min01s → verdict=redeploying，deploy 被调 1 次', async () => {
    const now = new Date('2026-07-16T10:00:00Z');
    // 首见时间 = 30min01s 前（满 30min）
    const driftFirstSeenAt = new Date(now.getTime() - (30 * 60 * 1000 + 1000)).toISOString(); // 30min01s

    const result = await runDriftCheck(makeOptions({
      mainSha: SHA_MAIN,
      prodSha: SHA_PROD,
      now,
      driftFirstSeenAt,
      redeployCount: 0,
    }));

    expect(result.verdict).toBe('redeploying');
    expect(mockExecDeploy).toHaveBeenCalledTimes(1);
    expect(mockExecDeploy).toHaveBeenCalledWith(expect.stringContaining('brain-deploy.sh'));
    expect(mockSendBark).not.toHaveBeenCalled();
  });

  // FR-15-network-err：拉取 main SHA 失败 → verdict=network_error
  it('FR-15-network-err: 拉取 main SHA 失败 → verdict=network_error，deploy 不被调', async () => {
    const result = await runDriftCheck(makeOptions({
      mainFails: true,
      now: new Date(),
    }));

    expect(result.verdict).toBe('network_error');
    expect(mockExecDeploy).not.toHaveBeenCalled();
  });

  // FR-15-prod-unreach：拉取 prod SHA 失败 → verdict=prod_unreachable
  it('FR-15-prod-unreach: 生产 /health 不可达 → verdict=prod_unreachable，deploy 不被调', async () => {
    const result = await runDriftCheck(makeOptions({
      prodFails: true,
      now: new Date(),
    }));

    expect(result.verdict).toBe('prod_unreachable');
    expect(mockExecDeploy).not.toHaveBeenCalled();
  });

  // FR-15-escalate：redeployCount>=2 且仍漂移 → verdict=escalated，sendBark 被调 1 次
  it('FR-15-escalate: redeployCount>=2 且仍漂移 → verdict=escalated，deploy 不被调，sendBark 被调 1 次', async () => {
    const now = new Date('2026-07-16T10:00:00Z');
    const driftFirstSeenAt = new Date(now.getTime() - (30 * 60 * 1000 + 5000)).toISOString();

    const result = await runDriftCheck(makeOptions({
      mainSha: SHA_MAIN,
      prodSha: SHA_PROD,
      now,
      driftFirstSeenAt,
      redeployCount: 2, // 已触发 2 次
    }));

    expect(result.verdict).toBe('escalated');
    expect(mockExecDeploy).not.toHaveBeenCalled();
    expect(mockSendBark).toHaveBeenCalledTimes(1);
    expect(mockSendBark).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ dedupeKey: 'drift-escalated' })
    );
  });

  // FR-15-boundary-29m59s：边界：29min59s 不触发（防抖边界下限）
  it('FR-15-boundary: 29min59s 不触发 → verdict=drifting', async () => {
    const now = new Date('2026-07-16T10:00:00Z');
    const driftFirstSeenAt = new Date(now.getTime() - (30 * 60 * 1000 - 1000)).toISOString();

    const result = await runDriftCheck(makeOptions({
      mainSha: SHA_MAIN,
      prodSha: SHA_PROD,
      now,
      driftFirstSeenAt,
    }));

    expect(result.verdict).toBe('drifting');
    expect(mockExecDeploy).not.toHaveBeenCalled();
  });

  // FR-15-boundary-30m01s：边界：30min01s 触发（防抖边界上限）
  it('FR-15-boundary: 30min01s 触发 → verdict=redeploying', async () => {
    const now = new Date('2026-07-16T10:00:00Z');
    const driftFirstSeenAt = new Date(now.getTime() - (30 * 60 * 1000 + 1000)).toISOString();

    const result = await runDriftCheck(makeOptions({
      mainSha: SHA_MAIN,
      prodSha: SHA_PROD,
      now,
      driftFirstSeenAt,
      redeployCount: 0,
    }));

    expect(result.verdict).toBe('redeploying');
    expect(mockExecDeploy).toHaveBeenCalledTimes(1);
  });

  // FR-15-首见：SHA 首次不等（无 driftFirstSeenAt）→ 记录时间戳，verdict=drifting
  it('FR-15-首见: SHA 首次不等且无历史记录 → verdict=drifting，deploy 不被调', async () => {
    const result = await runDriftCheck(makeOptions({
      mainSha: SHA_MAIN,
      prodSha: SHA_PROD,
      now: new Date(),
      driftFirstSeenAt: null,
    }));

    expect(result.verdict).toBe('drifting');
    expect(mockExecDeploy).not.toHaveBeenCalled();
  });

  // 常量校验：DRIFT_SENTINEL_INTERVAL_MS 应为 30min
  it('DRIFT_SENTINEL_INTERVAL_MS 默认为 30min（1800000ms）', () => {
    expect(DRIFT_SENTINEL_INTERVAL_MS).toBe(30 * 60 * 1000);
  });

  // 常量校验：DRIFT_WINDOW_MS 应为 30min
  it('DRIFT_WINDOW_MS 防抖窗口为 30min（1800000ms）', () => {
    expect(DRIFT_WINDOW_MS).toBe(30 * 60 * 1000);
  });
});
