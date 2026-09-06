// worker-pool-dispatch.test.js — 并行血管P1：worker 池自动派发
// 铁律：slot1-6 是 harness/主理人地盘，任何生成的命令绝不允许出现；worker 槽只用 slot7-9；
// 并发上限 2；发射即记 dispatch_events；预占 claimed_by='interactive-dev-skill'（/dev 409 预占约定）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runWorkerPoolDispatch,
  WORKER_SLOTS,
  MAX_CONCURRENT,
  __resetWorkerPoolDispatchForTest,
} from '../worker-pool-dispatch.js';

const QUEUED_TASK = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  title: '画布探索任务A',
  payload: { parallel_worker: true },
};
const QUEUED_TASK_B = {
  id: 'bbbbbbbb-0000-0000-0000-000000000002',
  title: '画布探索任务B',
  payload: { pipeline: 'canvas', canonical: 'exploratory' },
};

/**
 * mock execFn：按命令内容路由返回。
 * slotStates: { slot7: 'zsh'|'node'|'MISSING', ... }
 */
function makeExecFn(slotStates = {}) {
  const calls = [];
  const fn = vi.fn((cmd, opts) => {
    calls.push({ cmd, opts });
    // 探针必须是 list-panes:真机实证 display-message -p -t <不存在的会话> 返回
    // 空串+rc=0(而非报错),空串既非 MISSING 也非 shell 名 → 全槽误判 busy
    // (09-06 金丝雀案:busy=3 而宿主根本没有 slot7-9)。list-panes 对不存在
    // 会话报错 → || echo MISSING 真触发。
    const m = cmd.match(/list-panes[^']*-t (slot\d+)/);
    if (m) {
      const st = slotStates[m[1]] ?? 'MISSING';
      return st === 'MISSING' ? 'MISSING\n' : `${st}\n`;
    }
    if (/display-message/.test(cmd)) return ''; // 模拟真机行为:空串 rc=0
    return '';
  });
  fn.calls = calls;
  return fn;
}

/** mock pool：queued 任务查询返回 tasks；预占 UPDATE 返回 rowCount=1；其余返回空 */
function makePool(tasks = [], { claimRowCount = 1 } = {}) {
  const q = vi.fn(async (sql, _params) => {
    if (/FROM tasks/i.test(sql) && /queued/i.test(sql)) return { rows: tasks, rowCount: tasks.length };
    if (/UPDATE tasks/i.test(sql)) return { rows: [], rowCount: claimRowCount };
    return { rows: [], rowCount: 0 };
  });
  return { query: q };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetWorkerPoolDispatchForTest();
});

describe('常量契约', () => {
  it('worker 槽只有 slot7/8/9，并发上限 2', () => {
    expect(WORKER_SLOTS).toEqual(['slot7', 'slot8', 'slot9']);
    expect(MAX_CONCURRENT).toBe(2);
  });
});

describe('铁律：slot1-6 绝不出现在任何命令里', () => {
  it('正常发射一轮，所有 execFn 命令不含 slot1-slot6', async () => {
    const execFn = makeExecFn({ slot7: 'zsh', slot8: 'zsh', slot9: 'zsh' });
    const pool = makePool([QUEUED_TASK, QUEUED_TASK_B]);
    await runWorkerPoolDispatch(pool, { execFn });
    for (const { cmd } of execFn.calls) {
      expect(cmd).not.toMatch(/slot[1-6]\b/);
    }
    expect(execFn.calls.length).toBeGreaterThan(0);
  });
});

describe('槽位判定与发射', () => {
  it('空闲槽（shell pane）发射：send-keys 目标必须在 WORKER_SLOTS 内且记 dispatched', async () => {
    const execFn = makeExecFn({ slot7: 'zsh', slot8: 'node', slot9: 'MISSING' });
    const pool = makePool([QUEUED_TASK]);
    const r = await runWorkerPoolDispatch(pool, { execFn });
    expect(r.dispatched).toBe(1);
    const sendKeys = execFn.calls.filter(c => /send-keys/.test(c.cmd));
    expect(sendKeys.length).toBe(1);
    const target = sendKeys[0].cmd.match(/-t (slot\d+)/)[1];
    expect(WORKER_SLOTS).toContain(target);
    // 发射命令走 claude-launch.sh + /dev --task-id
    const inserts = pool.query.mock.calls.filter(([sql]) => /INSERT INTO dispatch_events/i.test(sql));
    expect(inserts.length).toBe(1);
    expect(inserts[0][1]).toContain(QUEUED_TASK.id);
    expect(inserts[0][1].join(' ')).toMatch(/dispatched/);
  });

  it('探针必须 list-panes:display-message 对不存在会话返回空串 rc=0 会全槽假忙(金丝雀案 busy=3)', async () => {
    // 真机行为:宿主无 slot7-9 时 display-message 探针返回 ''+rc=0,旧代码把空串判 busy
    // → concurrency_cap 永不派发。本用例锁死:探针走 list-panes,且空串归 missing 可派发。
    const calls = [];
    const execFn = vi.fn((cmd, opts) => {
      calls.push(cmd);
      if (/display-message/.test(cmd)) return ''; // 旧探针在真机上的返回
      if (/list-panes/.test(cmd)) return 'MISSING\n';
      return '';
    });
    const pool = makePool([QUEUED_TASK]);
    const r = await runWorkerPoolDispatch(pool, { execFn, now: () => 10_000_000, ssh: { host: null, opts: '' } });
    expect(calls.some(c => /list-panes/.test(c))).toBe(true);
    expect(r.skipped).not.toBe('concurrency_cap');
    expect(r.dispatched).toBe(1);
  });

  it('slot 不存在（MISSING）→ 先 new-session 再 send-keys', async () => {
    const execFn = makeExecFn({ slot7: 'node', slot8: 'node', slot9: 'MISSING' });
    // 两忙已达上限 → 不发射；改成一忙：
    const execFn2 = makeExecFn({ slot7: 'node', slot8: 'MISSING', slot9: 'MISSING' });
    const pool = makePool([QUEUED_TASK]);
    await runWorkerPoolDispatch(pool, { execFn: execFn2 });
    const newSession = execFn2.calls.filter(c => /new-session/.test(c.cmd));
    expect(newSession.length).toBe(1);
    expect(newSession[0].cmd).toMatch(/slot[789]/);
    void execFn;
  });

  it('发射 prompt 含 /dev --task-id 与 409 预占约定语', async () => {
    const execFn = makeExecFn({ slot7: 'zsh', slot8: 'zsh', slot9: 'zsh' });
    const pool = makePool([QUEUED_TASK]);
    await runWorkerPoolDispatch(pool, { execFn });
    const promptWrite = execFn.calls.find(c => c.opts?.input);
    expect(promptWrite).toBeTruthy();
    expect(promptWrite.opts.input).toMatch(/\/dev --task-id aaaaaaaa-0000-0000-0000-000000000001/);
    expect(promptWrite.opts.input).toMatch(/interactive-dev-skill/);
    expect(promptWrite.opts.input).toMatch(/预占/);
  });
});

describe('并发上限', () => {
  it('忙槽已达 2 → 本轮不发射不预占，只有探测调用', async () => {
    const execFn = makeExecFn({ slot7: 'node', slot8: 'claude', slot9: 'zsh' });
    const pool = makePool([QUEUED_TASK, QUEUED_TASK_B]);
    const r = await runWorkerPoolDispatch(pool, { execFn });
    expect(r.dispatched).toBe(0);
    expect(r.skipped).toBe('concurrency_cap');
    expect(execFn.calls.every(c => /list-panes/.test(c.cmd))).toBe(true);
    const claims = pool.query.mock.calls.filter(([sql]) => /UPDATE tasks/i.test(sql));
    expect(claims.length).toBe(0);
  });

  it('一忙一闲 + 两个队列任务 → 只发射 1 个（剩余额度=1）', async () => {
    const execFn = makeExecFn({ slot7: 'node', slot8: 'zsh', slot9: 'zsh' });
    const pool = makePool([QUEUED_TASK, QUEUED_TASK_B]);
    const r = await runWorkerPoolDispatch(pool, { execFn });
    expect(r.dispatched).toBe(1);
  });
});

describe('预占（/dev 409 约定）', () => {
  it('发射前 CAS 预占 claimed_by=interactive-dev-skill；预占失败（rowCount=0）不发射', async () => {
    const execFn = makeExecFn({ slot7: 'zsh', slot8: 'zsh', slot9: 'zsh' });
    const pool = makePool([QUEUED_TASK], { claimRowCount: 0 });
    const r = await runWorkerPoolDispatch(pool, { execFn });
    expect(r.dispatched).toBe(0);
    const claim = pool.query.mock.calls.find(([sql]) => /UPDATE tasks/i.test(sql));
    expect(claim[0]).toMatch(/interactive-dev-skill/);
    expect(claim[0]).toMatch(/claimed_by IS NULL/i);
    expect(execFn.calls.some(c => /send-keys/.test(c.cmd))).toBe(false);
  });
});

describe('队列扫描条件', () => {
  it('SQL 只挑 queued 且 parallel_worker=true 或 canvas+exploratory', async () => {
    const execFn = makeExecFn({ slot7: 'zsh' });
    const pool = makePool([]);
    await runWorkerPoolDispatch(pool, { execFn });
    const scan = pool.query.mock.calls.find(([sql]) => /FROM tasks/i.test(sql));
    expect(scan[0]).toMatch(/parallel_worker/);
    expect(scan[0]).toMatch(/exploratory/);
    expect(scan[0]).toMatch(/queued/);
  });
});

describe('5min 自 gate', () => {
  it('间隔内第二次调用直接 skip 不探测', async () => {
    const execFn = makeExecFn({ slot7: 'zsh' });
    const pool = makePool([]);
    let t = 1_000_000;
    const now = () => t;
    await runWorkerPoolDispatch(pool, { execFn, now });
    const callsAfterFirst = execFn.calls.length;
    t += 60 * 1000; // 只过 1 分钟
    const r = await runWorkerPoolDispatch(pool, { execFn, now });
    expect(r.skipped).toBe('interval_gate');
    expect(execFn.calls.length).toBe(callsAfterFirst);
    t += 5 * 60 * 1000; // 再过 5 分钟
    const r2 = await runWorkerPoolDispatch(pool, { execFn, now });
    expect(r2.skipped).not.toBe('interval_gate');
  });
});

describe('发射失败处理', () => {
  it('send-keys 抛错 → 记 failed_dispatch + 回滚 claim', async () => {
    const calls = [];
    const execFn = vi.fn((cmd, opts) => {
      calls.push({ cmd, opts });
      const m = cmd.match(/display-message[^']*-t (slot\d+)/);
      if (m) return 'zsh\n';
      if (/send-keys/.test(cmd)) throw new Error('tmux boom');
      return '';
    });
    const pool = makePool([QUEUED_TASK]);
    const r = await runWorkerPoolDispatch(pool, { execFn });
    expect(r.dispatched).toBe(0);
    const evts = pool.query.mock.calls.filter(([sql]) => /INSERT INTO dispatch_events/i.test(sql));
    expect(evts.length).toBe(1);
    expect(evts[0][1].join(' ')).toMatch(/failed_dispatch/);
    const rollback = pool.query.mock.calls.filter(([sql]) => /claimed_by\s*=\s*NULL/i.test(sql));
    expect(rollback.length).toBe(1);
  });
});
