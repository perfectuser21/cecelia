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
 * mock execFn：按命令内容路由返回，并模拟真机时序。
 * slotStates: { slot7: 'zsh'|'node'|'MISSING', ... }
 * onSendKeys: 发射后 pane 最终变成的命令名（null = 永远不接管，模拟 claude 没起来）
 * becomeBusyAfter: 发射后前 N 次探活仍是 shell，第 N+1 次才变（模拟秒级接管延迟）
 */
function makeExecFn(slotStates = {}, { onSendKeys = 'claude', becomeBusyAfter = 0 } = {}) {
  const calls = [];
  const state = { ...slotStates };
  const pending = {}; // slot -> 还需几次探活才接管
  const fn = vi.fn((cmd, opts) => {
    calls.push({ cmd, opts });
    const sk = cmd.match(/send-keys -t (slot\d+)/);
    if (sk && onSendKeys) { pending[sk[1]] = becomeBusyAfter; }
    const ks = cmd.match(/kill-session -t (slot\d+)/);
    if (ks) { state[ks[1]] = 'MISSING'; }
    // 探针必须是 list-panes:真机实证 display-message -p -t <不存在的会话> 返回
    // 空串+rc=0(而非报错),空串既非 MISSING 也非 shell 名 → 全槽误判 busy
    // (09-06 金丝雀案:busy=3 而宿主根本没有 slot7-9)。list-panes 对不存在
    // 会话报错 → || echo MISSING 真触发。
    const m = cmd.match(/list-panes[^']*-t (slot\d+)/);
    if (m) {
      const slot = m[1];
      if (pending[slot] !== undefined) {
        if (pending[slot] > 0) { pending[slot] -= 1; return 'zsh\n'; }
        state[slot] = onSendKeys;
      }
      const st = state[slot] ?? 'MISSING';
      return st === 'MISSING' ? 'MISSING\n' : `${st}\n`;
    }
    if (/display-message/.test(cmd)) return ''; // 模拟真机行为:空串 rc=0
    return '';
  });
  fn.calls = calls;
  return fn;
}

/** mock pool：queued 任务查询返回 tasks；预占 UPDATE 返回 rowCount=1；其余返回空 */
function makePool(tasks = [], { claimRowCount = 1, activeSlots = [] } = {}) {
  const q = vi.fn(async (sql, _params) => {
    // 僵尸判定查询：哪些 worker 槽还有在途任务对应（dispatch_events ⨝ tasks）
    if (/FROM dispatch_events/i.test(sql) && /SELECT/i.test(sql)) {
      return { rows: activeSlots.map(slot => ({ slot })), rowCount: activeSlots.length };
    }
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
    const pool = makePool([QUEUED_TASK], { activeSlots: ['slot8'] });
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
    let launched = false;
    const execFn = vi.fn((cmd, opts) => {
      calls.push(cmd);
      if (/display-message/.test(cmd)) return ''; // 旧探针在真机上的返回
      if (/list-panes/.test(cmd)) return launched ? 'claude\n' : 'MISSING\n';
      if (/send-keys/.test(cmd)) launched = true;
      return '';
    });
    const pool = makePool([QUEUED_TASK]);
    const r = await runWorkerPoolDispatch(pool, { execFn, now: () => 10_000_000, ssh: { host: null, opts: '' } });
    expect(calls.some(c => /list-panes/.test(c))).toBe(true);
    expect(r.skipped).not.toBe('concurrency_cap');
    expect(r.dispatched).toBe(1);
  });

  it('ssh 套壳时 $(cat promptFile) 必须转义 $:否则容器侧先求值成空串(金丝雀案 claude-launch.sh "")', async () => {
    // wrap() 只转义 \\ 和 ":双引号内的 $(...) 会被容器 shell 先展开——容器没有宿主的
    // prompt 文件 → cat 失败 → 发射命令落地成 claude-launch.sh "",worker 空转。
    const calls = [];
    let launched = false;
    const execFn = vi.fn((cmd, opts) => {
      calls.push(cmd);
      if (/list-panes/.test(cmd)) return launched ? 'claude\n' : 'MISSING\n';
      if (/send-keys/.test(cmd)) launched = true;
      return '';
    });
    const pool = makePool([QUEUED_TASK]);
    const r = await runWorkerPoolDispatch(pool, {
      execFn, now: () => 20_000_000,
      ssh: { host: 'administrator@host.docker.internal', opts: '-o BatchMode=yes' },
    });
    expect(r.dispatched).toBe(1);
    const sk = calls.find(c => /send-keys/.test(c));
    // ssh 双引号包裹里,$ 必须以 \$ 形态出现才能活到宿主端求值
    expect(sk).toMatch(/\\\$\(cat /);
    expect(sk).not.toMatch(/[^\\]\$\(cat /);
  });

  it('slot 不存在（MISSING）→ 先 new-session 再 send-keys', async () => {
    const execFn = makeExecFn({ slot7: 'node', slot8: 'node', slot9: 'MISSING' });
    // 两忙已达上限 → 不发射；改成一忙：
    const execFn2 = makeExecFn({ slot7: 'node', slot8: 'MISSING', slot9: 'MISSING' });
    const pool = makePool([QUEUED_TASK], { activeSlots: ['slot7'] });
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
    const pool = makePool([QUEUED_TASK, QUEUED_TASK_B], { activeSlots: ['slot7', 'slot8'] });
    const r = await runWorkerPoolDispatch(pool, { execFn });
    expect(r.dispatched).toBe(0);
    expect(r.skipped).toBe('concurrency_cap');
    expect(execFn.calls.every(c => /list-panes/.test(c.cmd))).toBe(true);
    const claims = pool.query.mock.calls.filter(([sql]) => /UPDATE tasks/i.test(sql));
    expect(claims.length).toBe(0);
  });

  it('一忙一闲 + 两个队列任务 → 只发射 1 个（剩余额度=1）', async () => {
    const execFn = makeExecFn({ slot7: 'node', slot8: 'zsh', slot9: 'zsh' });
    const pool = makePool([QUEUED_TASK, QUEUED_TASK_B], { activeSlots: ['slot7'] });
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

describe('第四病·发射前僵尸检测（残留 claude 占槽）', () => {
  const noSleep = async () => {};

  it('busy 槽在 DB 里没有在途任务对应 → 判僵尸,kill-session 后按 missing 重建', async () => {
    const execFn = makeExecFn({ slot7: 'claude', slot8: 'zsh', slot9: 'zsh' });
    const pool = makePool([QUEUED_TASK], { activeSlots: [] }); // 无任何在途任务认领 slot7
    const r = await runWorkerPoolDispatch(pool, { execFn, sleep: noSleep });
    const kills = execFn.calls.filter(c => /kill-session/.test(c.cmd));
    expect(kills.length).toBe(1);
    expect(kills[0].cmd).toMatch(/kill-session -t slot7/);
    expect(r.zombies).toEqual(['slot7']);
    expect(r.busy).toBe(0); // 僵尸不占产能
  });

  it('busy 槽有在途任务对应 → 绝不杀,老实算 busy', async () => {
    const execFn = makeExecFn({ slot7: 'claude', slot8: 'zsh', slot9: 'zsh' });
    const pool = makePool([QUEUED_TASK], { activeSlots: ['slot7'] });
    const r = await runWorkerPoolDispatch(pool, { execFn, sleep: noSleep });
    expect(execFn.calls.some(c => /kill-session/.test(c.cmd))).toBe(false);
    expect(r.busy).toBe(1);
    expect(r.zombies || []).toEqual([]);
  });

  it('僵尸清理只碰 slot7-9:slot1-6 永不出现在 kill 命令里', async () => {
    const execFn = makeExecFn({ slot7: 'claude', slot8: 'node', slot9: 'claude' });
    const pool = makePool([QUEUED_TASK], { activeSlots: [] });
    await runWorkerPoolDispatch(pool, { execFn, sleep: noSleep });
    const kills = execFn.calls.filter(c => /kill-session/.test(c.cmd));
    expect(kills.length).toBe(3);
    for (const k of kills) expect(k.cmd).not.toMatch(/slot[1-6]\b/);
  });

  it('僵尸判定 SQL 从 dispatch_events 关联在途任务(status 在途 + claimed_by 预占名)', async () => {
    const execFn = makeExecFn({ slot7: 'claude', slot8: 'zsh', slot9: 'zsh' });
    const pool = makePool([QUEUED_TASK], { activeSlots: ['slot7'] });
    await runWorkerPoolDispatch(pool, { execFn, sleep: noSleep });
    const q = pool.query.mock.calls.find(([sql]) => /FROM dispatch_events/i.test(sql));
    expect(q).toBeTruthy();
    expect(q[0]).toMatch(/in_progress/);
    expect(q[0]).toMatch(/interactive-dev-skill/);
  });
});

describe('第四病·发射后探活确认（同轮 + 跨轮重复发射）', () => {
  const noSleep = async () => {};

  it('pane 迟迟不离开 shell → 超时判 failed_dispatch(liveness) + 回滚 claim,不计 dispatched', async () => {
    const execFn = makeExecFn({ slot7: 'zsh', slot8: 'zsh', slot9: 'zsh' }, { onSendKeys: null });
    const pool = makePool([QUEUED_TASK]);
    const sleep = vi.fn(async () => {});
    const r = await runWorkerPoolDispatch(pool, { execFn, sleep });
    expect(r.dispatched).toBe(0);
    const evts = pool.query.mock.calls.filter(([sql]) => /INSERT INTO dispatch_events/i.test(sql));
    expect(evts.length).toBe(1);
    expect(evts[0][1].join(' ')).toMatch(/failed_dispatch/);
    expect(evts[0][1].join(' ')).toMatch(/liveness/);
    const rollback = pool.query.mock.calls.filter(([sql]) => /claimed_by\s*=\s*NULL/i.test(sql));
    expect(rollback.length).toBe(1);
    expect(sleep).toHaveBeenCalled(); // 真等过,不是发完就走
  });

  it('pane 秒级延迟才接管（前2次探活仍是 shell）→ 仍算发射成功', async () => {
    const execFn = makeExecFn({ slot7: 'zsh', slot8: 'zsh', slot9: 'zsh' }, { becomeBusyAfter: 2 });
    const pool = makePool([QUEUED_TASK]);
    const r = await runWorkerPoolDispatch(pool, { execFn, sleep: noSleep });
    expect(r.dispatched).toBe(1);
    const evts = pool.query.mock.calls.filter(([sql]) => /INSERT INTO dispatch_events/i.test(sql));
    expect(evts[0][1].join(' ')).toMatch(/dispatched/);
  });

  it('同轮：探活失败的槽不得被下一个任务复用（命令打进别人 composer 的原病）', async () => {
    const execFn = makeExecFn({ slot7: 'zsh', slot8: 'zsh', slot9: 'zsh' }, { onSendKeys: null });
    const pool = makePool([QUEUED_TASK, QUEUED_TASK_B]);
    await runWorkerPoolDispatch(pool, { execFn, sleep: noSleep });
    const targets = execFn.calls.filter(c => /send-keys/.test(c.cmd))
      .map(c => c.cmd.match(/-t (slot\d+)/)[1]);
    expect(targets.length).toBeGreaterThan(1);
    expect(new Set(targets).size).toBe(targets.length); // 无重复槽
  });

  it('跨轮：上轮发射成功后 pane 已 busy,下一轮同槽不会被二次发射（16:38→16:43 现场案）', async () => {
    const execFn = makeExecFn({ slot7: 'zsh', slot8: 'zsh', slot9: 'zsh' });
    let t = 100_000_000;
    const now = () => t;
    const r1 = await runWorkerPoolDispatch(makePool([QUEUED_TASK]), { execFn, now, sleep: noSleep });
    expect(r1.dispatched).toBe(1);
    const first = execFn.calls.filter(c => /send-keys/.test(c.cmd))
      .map(c => c.cmd.match(/-t (slot\d+)/)[1]);
    expect(first.length).toBe(1);
    const firstSlot = first[0];

    t += 6 * 60 * 1000; // 下一轮（5min gate 已过）
    const pool2 = makePool([QUEUED_TASK_B], { activeSlots: [firstSlot] });
    const r2 = await runWorkerPoolDispatch(pool2, { execFn, now, sleep: noSleep });
    const allTargets = execFn.calls.filter(c => /send-keys/.test(c.cmd))
      .map(c => c.cmd.match(/-t (slot\d+)/)[1]);
    expect(allTargets.slice(1)).not.toContain(firstSlot); // 第二轮没再打进同一个槽
    expect(r2.dispatched).toBe(1);
    expect(execFn.calls.some(c => /kill-session/.test(c.cmd))).toBe(false); // 有在途任务,不误杀
  });
});
