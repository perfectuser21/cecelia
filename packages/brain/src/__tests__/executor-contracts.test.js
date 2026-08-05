/**
 * executor-contracts.test.js
 *
 * TDD — 先红后绿
 * 合同矩阵：五 kind × alive/dead/unknown 三态
 * 特判：unknown 必须 fail-open（不杀，仅 warn + cecelia_events）
 *
 * 打标点映射：EXECUTOR_KIND_FOR 纯数据映射单测
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EXECUTOR_CONTRACTS,
  assessTaskLiveness,
  EXECUTOR_KIND_FOR,
  VALID_EXECUTOR_KINDS,
} from '../executor-contracts.js';

// ─── 辅助 ────────────────────────────────────────────────────────────────────

/** 构造假 task（仅含 assessTaskLiveness 需要的字段）*/
function makeTask(overrides = {}) {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    status: 'in_progress',
    executor_kind: null,
    updated_at: new Date(Date.now() - 65 * 60 * 1000).toISOString(), // 65min ago → stale
    last_attempt_at: new Date(Date.now() - 65 * 60 * 1000).toISOString(),
    claimed_by: null,
    ...overrides,
  };
}

/** 给 contract 注入 mock probe，然后调用 assessTaskLiveness */
async function runWithProbe(kind, probeResult, taskOverrides = {}) {
  const original = EXECUTOR_CONTRACTS[kind].probe;
  EXECUTOR_CONTRACTS[kind].probe = async () => probeResult;
  try {
    const task = makeTask({ executor_kind: kind, ...taskOverrides });
    return await assessTaskLiveness(task, {});
  } finally {
    EXECUTOR_CONTRACTS[kind].probe = original;
  }
}

// ─── VALID_EXECUTOR_KINDS ─────────────────────────────────────────────────────

describe('VALID_EXECUTOR_KINDS', () => {
  it('包含七个合法值（2026-08-05 增 codex-review-local：决策 9befa9c3 codex-review 活性 lock 文件探活）', () => {
    expect(VALID_EXECUTOR_KINDS).toEqual(
      expect.arrayContaining([
        'brain-local',
        'relay-container',
        'kernel-process',
        'headed-session',
        'bridge',
        'external-worker',
        'codex-review-local',
      ])
    );
    expect(VALID_EXECUTOR_KINDS).toHaveLength(7);
  });
});

// ─── EXECUTOR_KIND_FOR 打标映射 ───────────────────────────────────────────────

describe('EXECUTOR_KIND_FOR 打标映射', () => {
  it('harness_initiative → relay-container', () => {
    expect(EXECUTOR_KIND_FOR.harness_initiative).toBe('relay-container');
  });

  it('dev → brain-local（dispatcher 暂标）', () => {
    expect(EXECUTOR_KIND_FOR.dev).toBe('brain-local');
  });

  it('content-pipeline → external-worker', () => {
    expect(EXECUTOR_KIND_FOR['content-pipeline']).toBe('external-worker');
  });

  it('bridge 路径 → bridge', () => {
    expect(EXECUTOR_KIND_FOR.__bridge_path).toBe('bridge');
  });

  it('local codex/spawn 路径 → brain-local', () => {
    expect(EXECUTOR_KIND_FOR.__local_spawn).toBe('brain-local');
  });
});

// ─── EXECUTOR_CONTRACTS 结构校验 ──────────────────────────────────────────────

describe('EXECUTOR_CONTRACTS 结构', () => {
  const KINDS = ['brain-local', 'relay-container', 'headed-session', 'bridge', 'external-worker'];

  for (const kind of KINDS) {
    it(`${kind} 合同有 probe / staleMinutes / onStale`, () => {
      const c = EXECUTOR_CONTRACTS[kind];
      expect(c).toBeDefined();
      expect(typeof c.probe).toBe('function');
      expect('staleMinutes' in c).toBe(true);
      expect(typeof c.onStale).toBe('string');
    });
  }

  it('external-worker staleMinutes 为 null（永不超时）', () => {
    expect(EXECUTOR_CONTRACTS['external-worker'].staleMinutes).toBeNull();
    expect(EXECUTOR_CONTRACTS['external-worker'].onStale).toBe('never');
  });

  it('headed-session staleMinutes 为 120，onStale 为 release-claim-and-alert', () => {
    const c = EXECUTOR_CONTRACTS['headed-session'];
    expect(c.staleMinutes).toBe(120);
    expect(c.onStale).toBe('release-claim-and-alert');
  });

  it('brain-local staleMinutes 为 60，onStale 为 fail', () => {
    const c = EXECUTOR_CONTRACTS['brain-local'];
    expect(c.staleMinutes).toBe(60);
    expect(c.onStale).toBe('fail');
  });

  it('bridge staleMinutes 为 60，onStale 为 requeue', () => {
    const c = EXECUTOR_CONTRACTS['bridge'];
    expect(c.staleMinutes).toBe(60);
    expect(c.onStale).toBe('requeue');
  });
});

// ─── external-worker probe ────────────────────────────────────────────────────

describe('external-worker probe', () => {
  it('永远返回 alive', async () => {
    const result = await EXECUTOR_CONTRACTS['external-worker'].probe({}, {});
    expect(result).toBe('alive');
  });

  it('assessTaskLiveness → alive, onStale=never', async () => {
    const res = await runWithProbe('external-worker', 'alive');
    expect(res.verdict).toBe('alive');
    // external-worker staleMinutes=null → 不走超时判断
    expect(res.onStale).toBe('never');
  });
});

// ─── brain-local 合同矩阵 ─────────────────────────────────────────────────────

describe('brain-local 合同矩阵', () => {
  it('probe=alive → verdict=alive', async () => {
    const res = await runWithProbe('brain-local', 'alive');
    expect(res.verdict).toBe('alive');
  });

  it('probe=dead + updated_at 已超 60min → verdict=dead, onStale=fail', async () => {
    const res = await runWithProbe('brain-local', 'dead', {
      updated_at: new Date(Date.now() - 70 * 60 * 1000).toISOString(), // 70min ago
    });
    expect(res.verdict).toBe('dead');
    expect(res.onStale).toBe('fail');
  });

  it('probe=dead + updated_at < 60min → 不算超时，verdict=alive（宽限期内）', async () => {
    const res = await runWithProbe('brain-local', 'dead', {
      updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30min ago
    });
    expect(res.verdict).toBe('alive');
    expect(res.reason).toBe('within_stale_window');
  });

  it('probe=unknown → fail-open，verdict=unknown（不杀）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await runWithProbe('brain-local', 'unknown');
    expect(res.verdict).toBe('unknown');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fail-open'));
    warnSpy.mockRestore();
  });
});

// ─── relay-container 合同矩阵 ─────────────────────────────────────────────────

describe('relay-container 合同矩阵', () => {
  it('probe=alive → verdict=alive', async () => {
    const res = await runWithProbe('relay-container', 'alive');
    expect(res.verdict).toBe('alive');
  });

  it('probe=dead → verdict=dead, onStale=reignite', async () => {
    const res = await runWithProbe('relay-container', 'dead');
    // relay-container staleMinutes=null → dead 直接透传（无宽限期）
    expect(res.verdict).toBe('dead');
    expect(res.onStale).toBe('reignite');
  });

  it('probe=unknown → fail-open，verdict=unknown', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await runWithProbe('relay-container', 'unknown');
    expect(res.verdict).toBe('unknown');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fail-open'));
    warnSpy.mockRestore();
  });
});

// ─── headed-session 合同矩阵 ──────────────────────────────────────────────────

describe('headed-session 合同矩阵', () => {
  it('probe=alive → verdict=alive', async () => {
    const res = await runWithProbe('headed-session', 'alive');
    expect(res.verdict).toBe('alive');
  });

  it('probe=dead + 超 120min → verdict=dead, onStale=release-claim-and-alert', async () => {
    const res = await runWithProbe('headed-session', 'dead', {
      updated_at: new Date(Date.now() - 130 * 60 * 1000).toISOString(),
    });
    expect(res.verdict).toBe('dead');
    expect(res.onStale).toBe('release-claim-and-alert');
  });

  it('probe=dead + < 120min → 宽限期内，verdict=alive', async () => {
    const res = await runWithProbe('headed-session', 'dead', {
      updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    expect(res.verdict).toBe('alive');
    expect(res.reason).toBe('within_stale_window');
  });

  it('probe=unknown → fail-open，verdict=unknown', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await runWithProbe('headed-session', 'unknown');
    expect(res.verdict).toBe('unknown');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fail-open'));
    warnSpy.mockRestore();
  });
});

// ─── bridge 合同矩阵 ──────────────────────────────────────────────────────────

describe('bridge 合同矩阵', () => {
  it('probe=alive → verdict=alive', async () => {
    const res = await runWithProbe('bridge', 'alive');
    expect(res.verdict).toBe('alive');
  });

  it('probe=dead + 超 60min → verdict=dead, onStale=requeue', async () => {
    const res = await runWithProbe('bridge', 'dead', {
      updated_at: new Date(Date.now() - 70 * 60 * 1000).toISOString(),
    });
    expect(res.verdict).toBe('dead');
    expect(res.onStale).toBe('requeue');
  });

  it('probe=dead + < 60min → 宽限期内，verdict=alive', async () => {
    const res = await runWithProbe('bridge', 'dead', {
      updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });
    expect(res.verdict).toBe('alive');
    expect(res.reason).toBe('within_stale_window');
  });

  it('probe=unknown → fail-open，verdict=unknown', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await runWithProbe('bridge', 'unknown');
    expect(res.verdict).toBe('unknown');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fail-open'));
    warnSpy.mockRestore();
  });
});

// ─── assessTaskLiveness - 通用守卫 ────────────────────────────────────────────

describe('assessTaskLiveness 通用守卫', () => {
  it('executor_kind=null（legacy）→ fail-open，verdict=unknown', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = makeTask({ executor_kind: null });
    const res = await assessTaskLiveness(task, {});
    expect(res.verdict).toBe('unknown');
    expect(res.reason).toBe('no_executor_kind');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fail-open'));
    warnSpy.mockRestore();
  });

  it('executor_kind 未知值 → fail-open，verdict=unknown', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = makeTask({ executor_kind: 'unknown-future-kind' });
    const res = await assessTaskLiveness(task, {});
    expect(res.verdict).toBe('unknown');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fail-open'));
    warnSpy.mockRestore();
  });

  it('probe 抛异常 → fail-open，不抛', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = EXECUTOR_CONTRACTS['brain-local'].probe;
    EXECUTOR_CONTRACTS['brain-local'].probe = async () => { throw new Error('probe crash'); };
    const task = makeTask({ executor_kind: 'brain-local' });
    const res = await assessTaskLiveness(task, {});
    expect(res.verdict).toBe('unknown');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fail-open'));
    EXECUTOR_CONTRACTS['brain-local'].probe = original;
    warnSpy.mockRestore();
  });
});

// ─── brain-local probe 单元（mock activeProcesses）────────────────────────────

describe('brain-local probe 单元', () => {
  const probe = EXECUTOR_CONTRACTS['brain-local'].probe;

  it('activeProcesses 无记录 → unknown', async () => {
    const ctx = { activeProcesses: new Map() };
    const result = await probe({ id: 'task-1' }, ctx);
    expect(result).toBe('unknown');
  });

  it('activeProcesses bridge=true → unknown（bridge 任务不用 pid 探活）', async () => {
    const ctx = { activeProcesses: new Map([['task-2', { pid: 1234, bridge: true }]]) };
    const result = await probe({ id: 'task-2' }, ctx);
    expect(result).toBe('unknown');
  });

  it('pid 存活 → alive', async () => {
    // 用当前进程 PID（肯定存活）
    const myPid = process.pid;
    const ctx = { activeProcesses: new Map([['task-3', { pid: myPid, bridge: false }]]) };
    const result = await probe({ id: 'task-3' }, ctx);
    expect(result).toBe('alive');
  });

  it('pid 非正数（-1）→ unknown（invalid pid 无法探活）', async () => {
    const ctx = { activeProcesses: new Map([['task-4', { pid: -1, bridge: false }]]) };
    const result = await probe({ id: 'task-4' }, ctx);
    expect(result).toBe('unknown');
  });
});

// ─── external-worker probe 直接调用 ──────────────────────────────────────────

describe('external-worker probe 直接调用', () => {
  it('任何 task 任何 ctx 均返回 alive', async () => {
    const probe = EXECUTOR_CONTRACTS['external-worker'].probe;
    expect(await probe(null, null)).toBe('alive');
    expect(await probe({}, {})).toBe('alive');
    expect(await probe({ id: 'xyz' }, { activeProcesses: null })).toBe('alive');
  });
});
