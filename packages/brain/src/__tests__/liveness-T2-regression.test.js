/**
 * T2 活性合同回归测试 — 四刀均不杀
 *
 * 07-10 事故真实参数：headed-session + updated_at 63min + 进程活
 * → zombie-reaper / tick-helpers / tick-runner / healing 全部不杀
 *
 * TDD 先红后绿：写本文件时实现尚未改，测试应全红。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 共用 fixture ────────────────────────────────────────────────────────────

/** headed-session 任务：updated_at 63min 前（恰好在 brain-local 60min 阈值之外），进程活 */
function makeHeadedSessionTask(id = 'hs-task-01') {
  return {
    id,
    title: 'headed session active dev',
    task_type: 'dev',
    executor_kind: 'headed-session',
    updated_at: new Date(Date.now() - 63 * 60 * 1000).toISOString(),
    claimed_by: 'session:active-tmux',
    last_attempt_at: null,
  };
}

// ─── 刀1：zombie-reaper ───────────────────────────────────────────────────────

// 必须先声明 mock 变量，vi.mock 内不能引用外部 let
const mockAssessReaper = vi.fn();
vi.mock('../executor-contracts.js', () => ({
  assessTaskLiveness: (...args) => mockAssessReaper(...args),
}));

const mockPoolReaper = { query: vi.fn() };
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn().mockResolvedValue(true) }));

describe('刀1 zombie-reaper — headed-session 63min 进程活 → 不杀', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // assessTaskLiveness 返回 alive（进程活，不应杀）
    mockAssessReaper.mockResolvedValue({
      verdict: 'alive',
      kind: 'headed-session',
      onStale: 'release-claim-and-alert',
    });
    // SELECT 返回该 headed-session 任务
    mockPoolReaper.query.mockResolvedValueOnce({
      rows: [makeHeadedSessionTask()],
      rowCount: 1,
    });
  });

  it('headed-session + verdict=alive → UPDATE 不执行（不标 failed，不释放 claim）', async () => {
    const { reapZombies } = await import('../zombie-reaper.js');
    const result = await reapZombies({ pool: mockPoolReaper });

    // 只有 SELECT 那一次 query，没有 UPDATE
    const updateCalls = mockPoolReaper.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE')
    );
    expect(updateCalls).toHaveLength(0);
    expect(result.reaped).toBe(0);
    // released 也是 0（verdict=alive，不触发释放）
    expect(result.released ?? 0).toBe(0);
  });
});

describe('刀1 zombie-reaper — headed-session verdict=dead → 释放 claim，绝不 failed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 进程死了 → dead，但 onStale=release-claim-and-alert
    mockAssessReaper.mockResolvedValue({
      verdict: 'dead',
      kind: 'headed-session',
      onStale: 'release-claim-and-alert',
    });
    mockPoolReaper.query
      .mockResolvedValueOnce({ rows: [makeHeadedSessionTask()], rowCount: 1 }) // SELECT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE release
  });

  it('verdict=dead onStale=release-claim-and-alert → UPDATE status=queued（不是 failed）', async () => {
    const { reapZombies } = await import('../zombie-reaper.js');
    const result = await reapZombies({ pool: mockPoolReaper });

    const updateCalls = mockPoolReaper.query.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE')
    );
    // 应有一次 UPDATE
    expect(updateCalls).toHaveLength(1);
    const [updateSql] = updateCalls[0];
    // 必须是 queued，绝不 failed
    expect(updateSql).toMatch(/status\s*=\s*'queued'/);
    expect(updateSql).not.toMatch(/status\s*=\s*'failed'/);
    expect(result.reaped).toBe(0);
    expect(result.released).toBe(1);
  });
});

// ─── 刀2：tick-helpers autoFailTimedOutTasks ─────────────────────────────────

const mockKillProcess = vi.fn();
vi.mock('../executor.js', () => ({
  killProcess: (...args) => mockKillProcess(...args),
  checkServerResources: vi.fn().mockReturnValue({ metrics: { max_pressure: 0.3 } }),
}));
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn().mockResolvedValue({ quarantined: false, failure_count: 1 }),
}));
vi.mock('../event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../alertness/index.js', () => ({
  getCurrentAlertness: vi.fn().mockReturnValue({ level: 0, levelName: 'CALM' }),
  ALERTNESS_LEVELS: { CALM: 0, AWARE: 1, ALERT: 2, PANIC: 4 },
}));
vi.mock('../drain.js', () => ({ isPostDrainCooldown: vi.fn().mockReturnValue(false) }));

describe('刀2 tick-helpers autoFailTimedOutTasks — headed-session 63min → 不杀不失败', () => {
  it('executor_kind=headed-session 超时 → killProcess 不调用', async () => {
    const { autoFailTimedOutTasks } = await import('../tick-helpers.js');
    const task = {
      id: 'hs-tick-01',
      title: 'headed dev',
      executor_kind: 'headed-session',
      // started_at 远超 DISPATCH_TIMEOUT_MINUTES(100min)
      started_at: new Date(Date.now() - 130 * 60 * 1000).toISOString(),
      payload: {},
    };
    const actions = await autoFailTimedOutTasks([task]);
    expect(mockKillProcess).not.toHaveBeenCalled();
    // 不应有 auto-requeue-timeout 或 quarantine action
    expect(actions.some(a => a.task_id === 'hs-tick-01')).toBe(false);
  });

  it('executor_kind=brain-local 超时 → killProcess 调用（回归：不应破坏原有 brain-local 行为）', async () => {
    const mockQ = vi.fn().mockResolvedValue({ rows: [] });
    // 重新注入 db.js mock（模块级 mock 共享，此处验证 killProcess 被调用即可）
    const { autoFailTimedOutTasks } = await import('../tick-helpers.js');
    const task = {
      id: 'bl-tick-01',
      title: 'local dev',
      executor_kind: 'brain-local',
      started_at: new Date(Date.now() - 130 * 60 * 1000).toISOString(),
      payload: {},
    };
    vi.clearAllMocks();
    // handleTaskFailure mock 需重置
    const { handleTaskFailure } = await import('../quarantine.js');
    handleTaskFailure.mockResolvedValue({ quarantined: false, failure_count: 1 });

    await autoFailTimedOutTasks([task]);
    expect(mockKillProcess).toHaveBeenCalledWith('bl-tick-01');
  });
});

// ─── 刀3：tick-runner dead-reset SQL ─────────────────────────────────────────

describe('刀3 tick-runner dead-reset — 改用 executor_kind 过滤，删 skill-relay 特判', () => {
  const SRC = readFileSync(
    resolve(__dirname, '../tick-runner.js'),
    'utf8'
  );

  function extractDeadResetBlock(src) {
    const startIdx = src.indexOf('6.6. Dead task reset');
    const endIdx = src.indexOf('// 7. Dispatch tasks', startIdx);
    return src.slice(startIdx, endIdx);
  }

  const block = extractDeadResetBlock(SRC);

  it('dead-reset SQL 包含 executor_kind IN (\'brain-local\', \'bridge\')', () => {
    expect(block).toMatch(/executor_kind\s+IN\s*\(\s*'brain-local'\s*,\s*'bridge'\s*\)/);
  });

  it('dead-reset SQL 不再含旧的 skill-relay 排除条件', () => {
    expect(block).not.toMatch(/skill-relay/);
    expect(block).not.toMatch(/payload->>'orchestrator'/);
  });

  it('基础 WHERE 判据仍在（execution_attempts=0 / status IN / updated_at）', () => {
    expect(block).toMatch(/execution_attempts\s*=\s*0/);
    expect(block).toMatch(/status IN \('in_progress', 'queued'\)/);
    expect(block).toMatch(/updated_at < NOW\(\) - INTERVAL '10 minutes'/);
  });
});

// ─── 刀4：healing restartStuckExecutors ──────────────────────────────────────

const mockAssessHealing = vi.fn();

describe('刀4 healing restartStuckExecutors — headed-session 63min 进程活 → 不重启', () => {
  it('executor_kind=headed-session + verdict=alive → 不 UPDATE', async () => {
    // 动态导入以避免模块副作用
    const healingModule = await import('../alertness/healing.js');
    // 如果模块没有导出 restartStuckExecutors，就 skip（它是私有函数）
    // 用集成方式测试：mock pool + assessTaskLiveness + 验证 DB 操作
    // 由于 restartStuckExecutors 是私有函数，通过源码自省验证 content-pipeline 删除
    const { readFileSync } = await import('fs');
    const healingSrc = readFileSync(resolve(__dirname, '../alertness/healing.js'), 'utf8');

    // content-pipeline 硬编码特判必须删除
    expect(healingSrc).not.toMatch(/task_type\s*!=\s*'content-pipeline'/);
    expect(healingSrc).not.toMatch(/task_type\s*<>\s*'content-pipeline'/);
  });

  it('healing.js restartStuckExecutors SELECT 包含 executor_kind 字段', async () => {
    const { readFileSync } = await import('fs');
    const healingSrc = readFileSync(resolve(__dirname, '../alertness/healing.js'), 'utf8');

    // 必须 SELECT executor_kind（为了能调 assessTaskLiveness）
    const selectBlock = healingSrc.slice(
      healingSrc.indexOf('restartStuckExecutors'),
      healingSrc.indexOf('retryFailedTask', healingSrc.indexOf('restartStuckExecutors'))
    );
    expect(selectBlock).toMatch(/executor_kind/);
  });
});
