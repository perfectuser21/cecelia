/**
 * relay-container-heartbeat-probe.test.js
 *
 * TDD — 先红后绿
 *
 * 根因：T5/T6 九要素任务运行在 tmux session 而非 docker 容器，
 * relay-container probe docker ps 返回 dead，initiative_run_events
 * 07-04 起零写入（harness-controller 从未调 phase-event API），
 * autoFailTimedOutTasks 判死重排任务，造成今日两次误杀。
 *
 * 修法：relay-container probe 叠加 initiative_run_events 心跳检查：
 * - docker dead + 心跳 < 30min → alive（心跳救活）
 * - docker dead + 无心跳/心跳过期 → dead（原行为）
 * - docker alive → alive（不查 DB，快路径）
 * - docker 抛异常 + 无心跳 → unknown（fail-open）
 * - DB 查询异常 → unknown（fail-open）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── vi.hoisted：mock 工厂内引用的变量必须在此声明 ───────────────────────────
const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  execSync: vi.fn(() => ''),
}));

vi.mock('../db.js', () => ({
  default: { query: mocks.poolQuery },
}));

vi.mock('child_process', () => ({
  execSync: (...args) => mocks.execSync(...args),
  spawn: vi.fn(),
  exec: vi.fn(),
  execFile: vi.fn(),
}));

import { EXECUTOR_CONTRACTS } from '../executor-contracts.js';

const TASK_ID = 'aaaabbbb-1111-2222-3333-ccccddddeeee';

function makeTask(overrides = {}) {
  return {
    id: TASK_ID,
    executor_kind: 'relay-container',
    updated_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    last_attempt_at: null,
    claimed_by: null,
    ...overrides,
  };
}

function tsMinutesAgo(minutes) {
  return Math.floor((Date.now() - minutes * 60 * 1000) / 1000);
}

describe('relay-container probe — 叠加 phase-event 心跳检查', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execSync.mockReturnValue('');
    mocks.poolQuery.mockResolvedValue({ rows: [{ last_ts: null }] });
  });

  it('(H1) docker alive → probe 直接返回 alive，不查 DB', async () => {
    mocks.execSync.mockReturnValue('cecelia-relay-aaaabbbb-running');

    const result = await EXECUTOR_CONTRACTS['relay-container'].probe(makeTask(), {});

    expect(result).toBe('alive');
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('(H2) docker dead + 心跳 < 30min → alive（心跳救活）', async () => {
    mocks.execSync.mockReturnValue('');
    mocks.poolQuery.mockResolvedValue({ rows: [{ last_ts: tsMinutesAgo(5) }] });

    const result = await EXECUTOR_CONTRACTS['relay-container'].probe(makeTask(), {});

    expect(result).toBe('alive');
    expect(mocks.poolQuery).toHaveBeenCalledWith(
      expect.stringContaining('initiative_run_events'),
      [TASK_ID]
    );
  });

  it('(H3) docker dead + 心跳恰好 29min → alive（边界：在 30min 阈值内）', async () => {
    mocks.execSync.mockReturnValue('');
    mocks.poolQuery.mockResolvedValue({ rows: [{ last_ts: tsMinutesAgo(29) }] });

    const result = await EXECUTOR_CONTRACTS['relay-container'].probe(makeTask(), {});

    expect(result).toBe('alive');
  });

  it('(H4) docker dead + 心跳 30min 以上 → dead（心跳过期）', async () => {
    mocks.execSync.mockReturnValue('');
    mocks.poolQuery.mockResolvedValue({ rows: [{ last_ts: tsMinutesAgo(31) }] });

    const result = await EXECUTOR_CONTRACTS['relay-container'].probe(makeTask(), {});

    expect(result).toBe('dead');
  });

  it('(H5) docker dead + 无心跳（last_ts=null）→ dead', async () => {
    mocks.execSync.mockReturnValue('');
    mocks.poolQuery.mockResolvedValue({ rows: [{ last_ts: null }] });

    const result = await EXECUTOR_CONTRACTS['relay-container'].probe(makeTask(), {});

    expect(result).toBe('dead');
  });

  it('(H6) docker dead + initiative_run_events 无行 → dead', async () => {
    mocks.execSync.mockReturnValue('');
    mocks.poolQuery.mockResolvedValue({ rows: [] });

    const result = await EXECUTOR_CONTRACTS['relay-container'].probe(makeTask(), {});

    expect(result).toBe('dead');
  });

  it('(H7) docker 抛异常 + 心跳 < 30min → alive（心跳救活）', async () => {
    mocks.execSync.mockImplementation(() => { throw new Error('docker: command not found'); });
    mocks.poolQuery.mockResolvedValue({ rows: [{ last_ts: tsMinutesAgo(10) }] });

    const result = await EXECUTOR_CONTRACTS['relay-container'].probe(makeTask(), {});

    expect(result).toBe('alive');
  });

  it('(H8) docker 抛异常 + 无心跳 → unknown（fail-open）', async () => {
    mocks.execSync.mockImplementation(() => { throw new Error('docker not found'); });
    mocks.poolQuery.mockResolvedValue({ rows: [{ last_ts: null }] });

    const result = await EXECUTOR_CONTRACTS['relay-container'].probe(makeTask(), {});

    expect(result).toBe('unknown');
  });

  it('(H9) DB 查询抛异常 + docker dead → unknown（fail-open）', async () => {
    mocks.execSync.mockReturnValue('');
    mocks.poolQuery.mockRejectedValue(new Error('DB connection lost'));

    const result = await EXECUTOR_CONTRACTS['relay-container'].probe(makeTask(), {});

    expect(result).toBe('unknown');
  });

  it('(H10) 心跳查询使用正确的 initiative_id = task.id', async () => {
    const customId = 'custom-id-1111-2222-3333-4444';
    mocks.execSync.mockReturnValue('');
    mocks.poolQuery.mockResolvedValue({ rows: [{ last_ts: null }] });

    await EXECUTOR_CONTRACTS['relay-container'].probe(makeTask({ id: customId }), {});

    expect(mocks.poolQuery).toHaveBeenCalledWith(
      expect.any(String),
      [customId]
    );
  });
});
