import { describe, it, expect, vi } from 'vitest';
import {
  requeueOrphanTask,
  handleRelayExitConsistency,
  sweepOrphanHarnessTasks,
  startHarnessOrphanGuard,
  WAIT_SUICIDE_PATTERN,
} from '../harness-orphan-guard.js';

describe('startHarnessOrphanGuard', () => {
  it('接流量前立即完成一次 ownerless Kernel 收敛', async () => {
    vi.useFakeTimers();
    const reconcileOwnerless = vi.fn(async () => []);
    try {
      const timer = await startHarnessOrphanGuard({
        pool: {},
        execFn: vi.fn(),
        reconcileOwnerless,
        intervalMs: 300_000,
      });
      expect(reconcileOwnerless).toHaveBeenCalledOnce();
      clearInterval(timer);
    } finally {
      vi.useRealTimers();
    }
  });
});

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

  // 死锁根因(2026-08-07 W1/W2/W3 全灭):收割只动 tasks 不动 initiative_runs,
  // 打回 queued 的任务被 spawn-guard 按"还有活跃 run"一路拒到 requeue 超限。
  it('requeue 前先把该 task 的非终态 run 打成 failed(解 spawn-guard 死锁)', async () => {
    const pool = mockPool();
    await requeueOrphanTask(pool, task, 'sweep-orphan');
    const runIdx = pool.calls.findIndex((c) => c.sql.includes('UPDATE initiative_runs'));
    const taskIdx = pool.calls.findIndex((c) => c.sql.includes('UPDATE tasks'));
    expect(runIdx).toBeGreaterThanOrEqual(0);
    expect(pool.calls[runIdx].sql).toContain("phase = 'failed'");
    expect(pool.calls[runIdx].params).toContain('container_orphaned');
    // 顺序死规矩:run 先终态化,task 才回 queued——反过来会留下"queued 但重派被拒"的窗口
    expect(runIdx).toBeLessThan(taskIdx);
  });

  it('转 failed 那一路同样终态化 run(不留悬空活跃行)', async () => {
    const pool = mockPool();
    await requeueOrphanTask(pool, { ...task, payload: { orphan_requeue_count: 3 } }, 'x');
    expect(pool.calls.some((c) => c.sql.includes('UPDATE initiative_runs'))).toBe(true);
  });

  // 终态化没成功还照样 requeue 的话,等于亲手把死锁再造一遍:
  // task 回 queued、run 还活着 → spawn-guard 继续拒 → 白烧一次 requeue 额度。
  // 宁可这轮不动(任务本来就是 in_progress,是安全态),留给下一轮 sweep 重试。
  it('终态化 run 失败 → 本轮不动 task,留 in_progress 给下轮 sweep', async () => {
    const pool = mockPool();
    pool.query = vi.fn(async (sql, params) => {
      const s = String(sql);
      pool.calls.push({ sql: s, params });
      if (s.includes('UPDATE initiative_runs')) throw new Error('pg down');
      return { rows: [] };
    });
    const r = await requeueOrphanTask(pool, task, 'sweep-orphan');
    expect(r.action).toBe('deferred');
    expect(r.reason).toBe('run_terminalize_failed');
    expect(pool.calls.some((c) => c.sql.includes('UPDATE tasks'))).toBe(false);
  });

  it('终态化失败时连"转 failed"也不做(不留悬空活跃 run 挂在终态任务上)', async () => {
    const pool = mockPool();
    pool.query = vi.fn(async (sql, params) => {
      const s = String(sql);
      pool.calls.push({ sql: s, params });
      if (s.includes('UPDATE initiative_runs')) throw new Error('pg down');
      return { rows: [] };
    });
    const r = await requeueOrphanTask(pool, { ...task, payload: { orphan_requeue_count: 3 } }, 'x');
    expect(r.action).toBe('deferred');
    expect(pool.calls.some((c) => c.sql.includes('UPDATE tasks'))).toBe(false);
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

  it('run 已有 PR 证据但 task 漏写 generator_done → 回填交接状态且不 requeue', async () => {
    const pool = mockPool(taskRow);
    pool.query = vi.fn(async (sql, params) => {
      const s = String(sql);
      pool.calls.push({ sql: s, params });
      if (s.includes('SELECT id, status, task_type, payload FROM tasks')) {
        return { rows: [taskRow] };
      }
      if (s.includes('pr_evidence') && s.includes('UPDATE tasks')) {
        return {
          rows: [{
            id: taskRow.id,
            pr_url: 'https://github.com/perfectuser21/cecelia/pull/4779',
          }],
        };
      }
      return { rows: [] };
    });
    const execFn = vi.fn(() => '');

    const r = await handleRelayExitConsistency({
      pool,
      execFn,
      containerId,
      exitCode: 1,
      resultText: '',
    });

    expect(r.action).toBe('noop');
    expect(r.reason).toBe('generated_pr_reconciled');
    expect(pool.calls.some((c) => c.sql.includes('UPDATE initiative_runs'))).toBe(false);
    const handoff = pool.calls.find((c) => c.sql.includes('pr_evidence'));
    expect(handoff.sql).toContain("'generator_done', true");
  });

  it('PR 对账只认最新一次 run，最新 run 无 PR 时不能回退拾取旧 run 的 PR', async () => {
    const pool = mockPool(taskRow);
    pool.query = vi.fn(async (sql, params) => {
      const s = String(sql);
      pool.calls.push({ sql: s, params });
      if (s.includes('SELECT id, status, task_type, payload FROM tasks')) {
        return { rows: [taskRow] };
      }
      return { rows: [] };
    });

    await handleRelayExitConsistency({
      pool,
      execFn: vi.fn(() => ''),
      containerId,
      exitCode: 1,
      resultText: '',
    });

    const handoff = pool.calls.find((call) => call.sql.includes('UPDATE tasks AS t'));
    const latestRunStart = handoff.sql.indexOf('latest_run AS');
    const limit = handoff.sql.indexOf('LIMIT 1', latestRunStart);
    const prFilter = handoff.sql.indexOf('pr_url IS NOT NULL', latestRunStart);
    expect(latestRunStart).toBeGreaterThanOrEqual(0);
    expect(limit).toBeGreaterThan(latestRunStart);
    expect(prFilter).toBeGreaterThan(limit);
    expect(handoff.sql).not.toContain('COALESCE(t.pr_url, pr_evidence.pr_url)');
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
    const upd = pool.calls.find((c) => c.sql.includes('wait_suicide_count')
      || JSON.stringify(c.params).includes('wait_suicide_count'));
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
  it('sweep 发现 run 已有 PR 时补齐交接，不终态化 run', async () => {
    const pool = mockPool();
    pool.query = vi.fn(async (sql, params) => {
      const s = String(sql);
      pool.calls.push({ sql: s, params });
      if (s.includes("task_type LIKE 'harness%'")) {
        return {
          rows: [{
            id: 'ccccdddd-0000-0000-0000-000000000000',
            title: 't',
            payload: {},
            status: 'in_progress',
          }],
        };
      }
      if (s.includes('pr_evidence') && s.includes('UPDATE tasks')) {
        return {
          rows: [{
            id: 'ccccdddd-0000-0000-0000-000000000000',
            pr_url: 'https://github.com/perfectuser21/cecelia/pull/4779',
          }],
        };
      }
      return { rows: [] };
    });

    const r = await sweepOrphanHarnessTasks({ pool, execFn: () => '', idleMinutes: 15 });

    expect(r.prHandoffs).toBe(1);
    expect(r.requeued).toBe(0);
    expect(pool.calls.some((c) => c.sql.includes('UPDATE initiative_runs'))).toBe(false);
  });

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

  it('终态化 run 失败的任务计进 deferred,不冒充 failed', async () => {
    const pool = mockPool();
    pool.query = vi.fn(async (sql) => {
      const s = String(sql);
      pool.calls.push({ sql: s });
      if (s.includes('SELECT') && s.includes("task_type LIKE 'harness%'")) {
        return { rows: [{ id: 'ccccdddd-0000-0000-0000-000000000000', title: 't', payload: {}, status: 'in_progress' }] };
      }
      if (s.includes('initiative_run_events')) return { rows: [{ last_hb: 0 }] };
      if (s.includes('UPDATE initiative_runs')) throw new Error('pg down');
      return { rows: [] };
    });
    const r = await sweepOrphanHarnessTasks({ pool, execFn: () => '', idleMinutes: 15 });
    expect(r.deferred).toBe(1);
    expect(r.requeued).toBe(0);
    expect(r.failed).toBe(0);
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
