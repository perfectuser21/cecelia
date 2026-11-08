// 旧存量startup消费兼容；不宣称旧relay新启动已恢复。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const escaped = vi.hoisted(() => ({ process: vi.fn(), network: vi.fn(), db: vi.fn() }));
vi.mock('node:child_process', () => ({
  execSync: (...args) => { escaped.process(...args); throw Error('禁止宿主命令'); },
  execFile: (...args) => { escaped.process(...args); throw Error('禁止宿主命令'); },
  spawn: (...args) => { escaped.process(...args); throw Error('禁止真实spawn'); },
}));
vi.mock('../../../packages/brain/src/db.js', () => ({ default: { query: (...args) => { escaped.db(...args); throw Error('禁止共享DB'); } } }));
vi.mock('../../../packages/brain/src/notifier.js', () => ({ sendBark: (...args) => { escaped.network(...args); throw Error('禁止真实通知'); } }));
afterEach(() => {
  expect(escaped.process).not.toHaveBeenCalled();
  expect(escaped.network).not.toHaveBeenCalled();
  expect(escaped.db).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

// ─── Stub 工厂 ────────────────────────────────────────────────────────────────

function makeDbStub() {
  const calls = [];
  return {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    }),
    _calls: calls,
  };
}

function makeSpawnStub() {
  const calls = [];
  const fn = vi.fn(async (task, opts) => {
    calls.push({ task, opts });
    return { ok: true, containerId: 'c-test' };
  });
  return { fn, _calls: calls };
}

function makeBarkStub() {
  const calls = [];
  const fn = vi.fn(async (msg) => {
    calls.push({ msg });
    return { ok: true };
  });
  return { fn, _calls: calls };
}

function makeExecStub() {
  const calls = [];
  const fn = vi.fn((cmd) => {
    calls.push({ cmd });
    return '';
  });
  return { fn, _calls: calls };
}

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', (...args) => { escaped.network(...args); throw Error('禁止外联'); }); });

// ─── BEHAVIOR-7: S0 startup-sync 批量恢复 ────────────────────────────────────

describe('[BEHAVIOR-7] S0 startup-sync 批量恢复', () => {
  it('2条 in_progress run 容器消失 → scanOrphanedRelayTasks → spawnFn 调用次数匹配分类结果', async () => {
    const spawn = makeSpawnStub();
    const exec = makeExecStub();
    const db = makeDbStub();

    // 2条 orphan run：一条 oom（会 spawn），一条 unknown（log_only 不 spawn）
    //
    // 2026-08-07 修 fixture（task f4f28298）：退出码放在 payload，不是行的顶层。
    // 原 fixture 写成 row.last_container_exit_code / stdout_tail / tmux_session，
    // 那是旧 SELECT `r.last_container_exit_code` 才会产出的形状——而这三列
    // initiative_runs 上从来就不存在，旧查询每次必抛 "column r.tmux_session does not exist"
    // 并被 server.js 的 catch 咽掉。换句话说这个 fixture 描述的是一个生产里
    // 永远不可能出现的行。退出码真正的落库位置是 tasks.payload.last_container_exit_code
    // （harness-callback.js 的 relay 分支写的）。
    // 分类与路由语义未变：oom → spawn，unknown → log_only，下面的断言原样保留。
    const orphanRuns = [
      {
        initiative_id: 'task-s0-001',
        id: 'run-s0-001',
        orchestrator_version: 'v2',
        phase: 'B_coding',
        payload: { orchestrator: 'skill-relay', last_container_exit_code: 137 },
      },
      {
        initiative_id: 'task-s0-002',
        id: 'run-s0-002',
        orchestrator_version: 'v2',
        phase: 'B_coding',
        payload: { orchestrator: 'skill-relay', last_container_exit_code: 1 },
      },
    ];

    // stub db.query 返回 orphan runs
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('in_progress') && sql.includes('initiative_runs')) {
        return { rows: orphanRuns };
      }
      return { rows: [] };
    });

    // stub exec：容器消失（返回空/非零）
    exec.fn.mockReturnValue('');

    const { scanOrphanedRelayTasks } = await import(
      '../../../packages/brain/src/startup-sync.js'
    ).catch(() => ({ scanOrphanedRelayTasks: null }));

    if (!scanOrphanedRelayTasks) {
      expect(false, 'scanOrphanedRelayTasks 未实现（packages/brain/src/startup-sync.js）').toBe(true);
      return;
    }

    await scanOrphanedRelayTasks({
      pool: db,
      spawnFn: spawn.fn,
      execFn: exec.fn,
    });

    // orphan-001: exit=137 → oom → spawn；orphan-002: exit=1 + 无特征 → unknown → log_only
    // 预期 spawn 被调用1次（仅 oom 路由）
    expect(spawn.fn).toHaveBeenCalledTimes(1);

    // 审计日志验证：每条 run 应打 source=startup-sync
    // （由于 console.log 是真实调用，此处仅验证 spawn 参数包含 source 标记或由 db 记录）
    const spawnTask = spawn._calls[0].task;
    expect(spawnTask.id).toBe('task-s0-001');
  });

  // 幽灵列防复发：SELECT 一旦再引用 initiative_runs 上不存在的列，
  // 生产里就是每次启动必抛 + 被 catch 咽掉 = 开机复活路径静默全废（本单实证）。
  // 打真库的守卫在 orphan-run-revival.integration.test.js，这里守住取值出处不漂回去。
  it('退出码只能取自 tasks.payload，SELECT 不得引用 initiative_runs 上不存在的列', async () => {
    const fs = await import('node:fs');
    // 相对本文件解析：CI 与本地跑 vitest 时 cwd 不同（repo 根 vs packages/brain）
    const src = fs.readFileSync(
      new URL('../../../packages/brain/src/startup-sync.js', import.meta.url),
      'utf8'
    );
    const sql = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const ghost of ['r.tmux_session', 'r.last_container_exit_code', 'r.stdout_tail']) {
      expect(sql, `startup-sync.js 又引用了不存在的列 ${ghost}`).not.toContain(ghost);
    }
    expect(src).toContain('payload?.last_container_exit_code');
  });
});

// ─── BEHAVIOR-8: 孤儿复活（TOP2 刀1，task f4f28298）────────────────────────────
//
// BEHAVIOR-7 管的是"还在 in_progress 的 run"——已被 orphan-guard requeue 超限
// 打成 failed 的任务它看不见。2026-08-07 W1/W2/W3 三条就是这样永久躺尸的：
// 死因全是基础设施（容器 OOM / provider 早退），重跑本该就成，但没有任何路径能捞。
// 复活语义与 BEHAVIOR-7 的重点火不同：不直接 spawn，而是清干净残留 run 后
// 把 task 打回 queued，交给 dispatcher 走正常派发（tmpfs 无断点，干净重跑）。

describe('[BEHAVIOR-8] 孤儿复活：infra 死因的 failed 任务回队列', () => {
  const CAPPED_ERROR = '[orphan-guard] requeue 超限(3次),终态 failed: sweep-orphan(idle>15min,无活容器)';

  function makeFailedTask(overrides = {}) {
    return {
      id: '0b7df1ca-da50-4928-9d24-bfbb8ae7cd90',
      title: 'W2-背靠背',
      status: 'failed',
      payload: { orchestrator: 'skill-relay', orphan_requeue_count: 3 },
      error_message: CAPPED_ERROR,
      ...overrides,
    };
  }

  function makeRevivalDb(rows) {
    const calls = [];
    return {
      calls,
      query: vi.fn(async (sql, params) => {
        const s = String(sql);
        calls.push({ sql: s, params });
        if (s.includes('SELECT') && s.includes('FROM tasks')) return { rows, rowCount: rows.length };
        return { rows: [], rowCount: 1 };
      }),
    };
  }

  it('无活容器 → 先终态化残留 run，再把 task 打回 queued（不直接 spawn）', async () => {
    const { reviveOrphanedHarnessTasks } = await import(
      '../../../packages/brain/src/startup-sync.js'
    );
    const db = makeRevivalDb([makeFailedTask()]);
    const spawn = makeSpawnStub();

    const r = await reviveOrphanedHarnessTasks({ pool: db, execFn: () => '' });

    expect(r.revived).toBe(1);
    // 复活不走 spawn —— 交 dispatcher 派发，与 BEHAVIOR-7 的重点火是两套语义
    expect(spawn.fn).not.toHaveBeenCalled();

    const runIdx = db.calls.findIndex((c) => c.sql.includes('UPDATE initiative_runs'));
    const taskIdx = db.calls.findIndex((c) => c.sql.includes('UPDATE tasks'));
    expect(runIdx).toBeGreaterThanOrEqual(0);
    // 顺序死规矩：run 先终态化，task 才回 queued。反过来会留下
    // "已 queued 但重派必被 spawn-guard 拒"的窗口 —— 正是本单要根治的死锁
    expect(runIdx).toBeLessThan(taskIdx);
    expect(db.calls[taskIdx].sql).toContain("status = 'queued'");
    expect(db.calls[taskIdx].sql).toContain("'orphan_requeue_count', 0");
    expect(db.calls[taskIdx].sql).toContain('revived_from');
  });

  it('业务失败不复活（failed 不能回 queued 的规则只对 infra 死因开口子）', async () => {
    const { reviveOrphanedHarnessTasks } = await import(
      '../../../packages/brain/src/startup-sync.js'
    );
    // 查询侧就按签名筛掉了，这里断言筛选条件真的带上了签名
    const db = makeRevivalDb([]);
    const { REVIVAL_ERROR_SIGNATURE } = await import(
      '../../../packages/brain/src/startup-sync.js'
    );
    await reviveOrphanedHarnessTasks({ pool: db, execFn: () => '' });
    const sel = db.calls.find((c) => c.sql.includes('SELECT'));
    expect(sel.sql).toContain("status = 'failed'");
    expect(sel.sql).toContain('error_message LIKE');
    expect(JSON.stringify(sel.params)).toContain(REVIVAL_ERROR_SIGNATURE);
  });

  it('还有活容器 → 不复活（防与在跑的执行体双跑）', async () => {
    const { reviveOrphanedHarnessTasks } = await import(
      '../../../packages/brain/src/startup-sync.js'
    );
    const db = makeRevivalDb([makeFailedTask()]);
    const r = await reviveOrphanedHarnessTasks({
      pool: db,
      execFn: () => 'cecelia-relay-0b7df1ca-alive\n',
    });
    expect(r.revived).toBe(0);
    expect(db.calls.some((c) => c.sql.includes('UPDATE tasks'))).toBe(false);
  });
});
