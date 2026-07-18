import { describe, it, expect, vi } from 'vitest';
import {
  requeueOrphanTask,
  handleRelayExitConsistency,
  sweepOrphanHarnessTasks,
  WAIT_SUICIDE_PATTERN,
} from '../harness-orphan-guard.js';

function mockPool(taskRow) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      const s = String(sql);
      if (s.includes('SELECT') && s.includes('FROM tasks')) {
        return { rows: taskRow ? [taskRow] : [] };
      }
      if (s.includes('initiative_run_events')) return { rows: [{ last_hb: 0 }] };
      return { rows: [] };
    }),
  };
}

describe('WAIT_SUICIDE_PATTERN', () => {
  it('命中"等 Monitor 通知"族措辞,不误伤正常结语', () => {
    expect(WAIT_SUICIDE_PATTERN.test('6 个 checks 还在跑（无失败），等 Monitor 通知。')).toBe(true);
    expect(WAIT_SUICIDE_PATTERN.test('waiting for Monitor notification before proceeding')).toBe(true);
    expect(WAIT_SUICIDE_PATTERN.test('等待通知到达后继续')).toBe(true);
    expect(WAIT_SUICIDE_PATTERN.test('全部完成,PR 已合并')).toBe(false);
  });
});

describe('requeueOrphanTask', () => {
  const task = { id: 'aaaabbbb-0000-0000-0000-000000000000', payload: {} };

  it('计数未达上限 → 打回 queued 并清 claim,计数+1', async () => {
    const pool = mockPool();
    const r = await requeueOrphanTask(pool, task, 'callback-exit-nonterminal');
    expect(r.action).toBe('requeued');
    const upd = pool.calls.find((c) => c.sql.includes('UPDATE tasks'));
    expect(upd.sql).toContain("status = 'queued'");
    expect(upd.sql).toContain('claimed_by = NULL');
    expect(upd.sql).toContain('orphan_requeue_count');
    expect(upd.sql).toContain("status = 'in_progress'"); // 条件守卫:只动 in_progress
  });

  it('计数已达上限(3) → 转 failed 终态,防死循环', async () => {
    const pool = mockPool();
    const capped = { ...task, payload: { orphan_requeue_count: 3 } };
    const r = await requeueOrphanTask(pool, capped, 'x');
    expect(r.action).toBe('failed');
    const upd = pool.calls.find((c) => c.sql.includes('UPDATE tasks'));
    expect(upd.sql).toContain("status = 'failed'");
  });
});

describe('handleRelayExitConsistency', () => {
  const shortId = 'aaaabbbb';
  const containerId = `cecelia-relay-${shortId}-deadbeef`;
  const taskRow = {
    id: 'aaaabbbb-0000-0000-0000-000000000000',
    status: 'in_progress',
    task_type: 'harness_initiative',
    payload: {},
  };

  it('任务已终态 → 不动', async () => {
    const pool = mockPool({ ...taskRow, status: 'completed' });
    const execFn = vi.fn(() => '');
    const r = await handleRelayExitConsistency({ pool, execFn, containerId, exitCode: 0, resultText: '' });
    expect(r.action).toBe('noop');
  });

  it('任务 in_progress 且同 initiative 还有别的活容器 → 不动(防双跑)', async () => {
    const pool = mockPool(taskRow);
    const execFn = vi.fn(() => `cecelia-relay-${shortId}-alive1\n`);
    const r = await handleRelayExitConsistency({ pool, execFn, containerId, exitCode: 1, resultText: '' });
    expect(r.action).toBe('noop');
    expect(execFn).toHaveBeenCalled();
  });

  it('任务 in_progress 且无活容器 → requeue', async () => {
    const pool = mockPool(taskRow);
    const execFn = vi.fn(() => `${containerId}\n`); // 只有自己(正在退出的这个)
    const r = await handleRelayExitConsistency({ pool, execFn, containerId, exitCode: 1, resultText: '' });
    expect(r.action).toBe('requeued');
  });

  it('等待措辞自杀 → requeue 且标记 suicide 计数', async () => {
    const pool = mockPool(taskRow);
    const execFn = vi.fn(() => '');
    const r = await handleRelayExitConsistency({
      pool, execFn, containerId, exitCode: 0,
      resultText: '6 个 checks 还在跑（无失败），等 Monitor 通知。',
    });
    expect(r.action).toBe('requeued');
    expect(r.suicide).toBe(true);
    const upd = pool.calls.find((c) => c.sql.includes('UPDATE tasks'));
    expect(JSON.stringify(upd.params)).toContain('wait_suicide_count');
  });

  it('docker 查询抛错 → fail-open 不动(宁漏不误杀)', async () => {
    const pool = mockPool(taskRow);
    const execFn = vi.fn(() => { throw new Error('docker down'); });
    const r = await handleRelayExitConsistency({ pool, execFn, containerId, exitCode: 1, resultText: '' });
    expect(r.action).toBe('noop');
  });
});

describe('sweepOrphanHarnessTasks', () => {
  it('无活容器且无新鲜心跳的 in_progress harness 任务 → requeue', async () => {
    const pool = mockPool();
    pool.query = vi.fn(async (sql) => {
      const s = String(sql);
      pool.calls.push({ sql: s });
      if (s.includes('SELECT') && s.includes("task_type LIKE 'harness%'")) {
        return { rows: [{ id: 'ccccdddd-0000-0000-0000-000000000000', title: 't', payload: {}, status: 'in_progress' }] };
      }
      if (s.includes('initiative_run_events')) return { rows: [{ last_hb: 0 }] };
      return { rows: [] };
    });
    const execFn = vi.fn(() => '');
    const r = await sweepOrphanHarnessTasks({ pool, execFn, idleMinutes: 15 });
    expect(r.requeued).toBe(1);
    expect(pool.calls.some((c) => c.sql.includes("status = 'queued'"))).toBe(true);
  });

  it('有活容器 → 跳过', async () => {
    const pool = mockPool();
    pool.query = vi.fn(async (sql) => {
      const s = String(sql);
      if (s.includes("task_type LIKE 'harness%'")) {
        return { rows: [{ id: 'ccccdddd-0000-0000-0000-000000000000', title: 't', payload: {}, status: 'in_progress' }] };
      }
      if (s.includes('initiative_run_events')) return { rows: [{ last_hb: 0 }] };
      return { rows: [] };
    });
    const execFn = vi.fn(() => 'cecelia-relay-ccccdddd-live1\n');
    const r = await sweepOrphanHarnessTasks({ pool, execFn, idleMinutes: 15 });
    expect(r.requeued).toBe(0);
  });
});

// ─── 终审必修回归锁:收权分界(generator_done 归 relay-watchdog,闸不抢) ────────
describe('收权分界:generator_done 后闸让位 watchdog', () => {
  const shortId = 'aaaabbbb';
  const containerId = `cecelia-relay-${shortId}-deadbeef`;

  it('callback 闸:任务 generator_done=true → noop(PR 态收口归 watchdog)', async () => {
    const pool = mockPool({
      id: 'aaaabbbb-0000-0000-0000-000000000000', status: 'in_progress',
      task_type: 'harness_initiative', payload: { generator_done: true },
    });
    const execFn = vi.fn(() => '');
    const r = await handleRelayExitConsistency({ pool, execFn, containerId, exitCode: 0, resultText: '等 Monitor 通知' });
    expect(r.action).toBe('noop');
  });

  it('sweep:SELECT 排除 generator_done 任务', async () => {
    const pool = mockPool();
    pool.query = vi.fn(async (sql) => {
      pool.calls.push({ sql: String(sql) });
      return { rows: [] };
    });
    await sweepOrphanHarnessTasks({ pool, execFn: vi.fn(() => ''), idleMinutes: 15 });
    const sel = pool.calls.find((c) => c.sql.includes("task_type LIKE 'harness%'"));
    expect(sel.sql).toContain('generator_done');
  });
});

describe('WAIT_SUICIDE_PATTERN 头号死因原句(终审 Minor1 回归锁)', () => {
  it('命中"等待 CI 结果通知"', () => {
    expect(WAIT_SUICIDE_PATTERN.test('PR 已开出,等待 CI 结果通知。')).toBe(true);
  });
});
