/**
 * TDD Red — codex headed tmux watchdog
 * Sprint: sprints/07071654-codex-headed-dispatch
 *
 * 测试 harness-relay-watchdog.js 的 headed 分支：
 * 1. watchdog ssh 命令失败 → fail-open（不重点火）
 * 2. 收窗幂等：run done → kill session，已收过不重复 kill
 *
 * 这些测试在实现前都应 FAIL（TDD Red 阶段）。
 */
import { describe, it, expect, vi } from 'vitest';
import { resumeStalledRelayRuns } from '../harness-relay-watchdog.js';

/** 构造 headed run 的 DB 行 */
function makeHeadedRun(overrides = {}) {
  return {
    initiative_id: 'bbbbcccc-dddd-eeee-ffff-000011112222',
    phase: 'A_planning',
    deadline_at: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8h 后
    pr_url: null,
    orchestrator_host: 'skill-relay-codex-headed',
    attempts: '1',
    ...overrides,
  };
}

/** 构造活跃 headed task */
function makeHeadedTask(overrides = {}) {
  return {
    id: 'bbbbcccc-dddd-eeee-ffff-000011112222',
    status: 'in_progress',
    title: 'headed watchdog test task',
    description: null,
    payload: {
      orchestrator: 'skill-relay',
      executor: 'codex',
      mode: 'headed',
      ssh_host: 'localhost',
      sprint_dir: 'sprints/07071654-codex-headed-dispatch',
    },
    pr_url: null,
    ...overrides,
  };
}

function makeWatchdogDeps(overrides = {}) {
  const run = makeHeadedRun();
  const task = makeHeadedTask();

  const pool = {
    query: vi.fn().mockImplementation((sql) => {
      // initiative_runs 查询
      if (/SELECT DISTINCT ON.*initiative_runs/.test(sql)) {
        return Promise.resolve({ rows: [run] });
      }
      // task 查询
      if (/SELECT.*FROM tasks WHERE id/.test(sql)) {
        return Promise.resolve({ rows: [task] });
      }
      // 其他查询（UPDATE 等）
      return Promise.resolve({ rows: [] });
    }),
  };

  return {
    pool,
    execFn: vi.fn().mockReturnValue('0'), // 默认 ssh tmux has-session exit 0（session 存在）
    spawnFn: vi.fn().mockResolvedValue({ containerId: 'cid' }),
    ...overrides,
  };
}

describe('watchdog headed 分支', () => {

  describe('1. fail-open — ssh 命令本身失败时不重点火', () => {
    it('ssh 命令抛错（connection refused）→ fail-open：不重点火（spawnFn 不被调用）', async () => {
      const deps = makeWatchdogDeps({
        // ssh 本身失败（非 session 不存在，是连接级别失败）
        execFn: vi.fn().mockImplementation((cmd) => {
          if (cmd.includes('tmux has-session')) {
            throw new Error('ssh: connect to host localhost port 22: Connection refused');
          }
          return '0';
        }),
      });

      const result = await resumeStalledRelayRuns(deps);

      // TDD Red: fail-open 实现前 FAIL
      // ssh 失败时不重点火
      expect(deps.spawnFn).not.toHaveBeenCalled();
      // 不计为存活失败，不产生错误
      expect(result.resumed).toBe(0);
    });

    it('ssh 超时（ETIMEDOUT）→ fail-open：run phase 不变', async () => {
      const deps = makeWatchdogDeps({
        execFn: vi.fn().mockImplementation((cmd) => {
          if (cmd.includes('tmux has-session')) {
            const err = new Error('ssh operation timed out');
            err.code = 'ETIMEDOUT';
            throw err;
          }
          return '0';
        }),
      });

      await resumeStalledRelayRuns(deps);

      // ssh 超时时不应触发 UPDATE phase=failed 等变更
      const updatePhaseCalls = deps.pool.query.mock.calls.filter(
        ([sql]) => /UPDATE.*initiative_runs.*phase.*failed/i.test(sql)
      );
      expect(updatePhaseCalls.length).toBe(0);
    });

    it('tmux has-session 返回非零（session 消失）→ 正常触发重点火（非 ssh 失败）', async () => {
      const deps = makeWatchdogDeps({
        execFn: vi.fn().mockImplementation((cmd) => {
          if (cmd.includes('tmux has-session')) {
            // session 不存在：exit code 非零（模拟 execSync 抛错 exit 1）
            const err = new Error("can't find session codex-relay-bbbbcccc");
            err.status = 1;
            throw err;
          }
          return '0'; // 其他命令
        }),
      });

      // TDD Red: session 消失 + run 未 done + PR 未 MERGED → 触发重点火
      const result = await resumeStalledRelayRuns(deps);
      expect(result.resumed).toBeGreaterThan(0);
    });
  });

  describe('2. 收窗幂等 — run done 后 kill session，已收过不重复 kill', () => {
    it('run phase=done 且 completed_at 超 30min → watchdog 调用 kill-session（tmux kill-session 命令）', async () => {
      const killCmds = [];
      const doneRun = makeHeadedRun({
        phase: 'done',
        completed_at: new Date(Date.now() - 31 * 60 * 1000), // 31 分钟前完成
        tmux_killed_at: null, // 尚未收窗
      });

      const pool = {
        query: vi.fn().mockImplementation((sql) => {
          if (/SELECT DISTINCT ON.*initiative_runs/.test(sql)) {
            return Promise.resolve({ rows: [doneRun] });
          }
          if (/SELECT.*FROM tasks WHERE id/.test(sql)) {
            return Promise.resolve({ rows: [makeHeadedTask()] });
          }
          return Promise.resolve({ rows: [] });
        }),
      };

      const deps = {
        pool,
        execFn: vi.fn().mockImplementation((cmd) => {
          if (cmd.includes('kill-session')) {
            killCmds.push(cmd);
          }
          return '0';
        }),
        spawnFn: vi.fn(),
      };

      // TDD Red: 收窗逻辑实现前 FAIL
      await resumeStalledRelayRuns(deps);

      // 应该调用 tmux kill-session
      expect(killCmds.length).toBeGreaterThan(0);
      expect(killCmds[0]).toContain('kill-session');
      expect(killCmds[0]).toContain('codex-relay-');
    });

    it('run 已有 tmux_killed_at（已收过）→ 不重复调用 kill-session（幂等）', async () => {
      const killCmds = [];
      const alreadyKilledRun = makeHeadedRun({
        phase: 'done',
        completed_at: new Date(Date.now() - 31 * 60 * 1000),
        tmux_killed_at: new Date(Date.now() - 5 * 60 * 1000), // 已收窗
      });

      const pool = {
        query: vi.fn().mockImplementation((sql) => {
          if (/SELECT DISTINCT ON.*initiative_runs/.test(sql)) {
            return Promise.resolve({ rows: [alreadyKilledRun] });
          }
          if (/SELECT.*FROM tasks WHERE id/.test(sql)) {
            return Promise.resolve({ rows: [makeHeadedTask()] });
          }
          return Promise.resolve({ rows: [] });
        }),
      };

      const deps = {
        pool,
        execFn: vi.fn().mockImplementation((cmd) => {
          if (cmd.includes('kill-session')) {
            killCmds.push(cmd);
          }
          return '0';
        }),
        spawnFn: vi.fn(),
      };

      // TDD Red: 幂等逻辑实现前 FAIL
      await resumeStalledRelayRuns(deps);

      // 已收过 → 不重复 kill
      expect(killCmds.length).toBe(0);
    });

    it('收窗后 DB 写入 tmux_killed_at 时间戳（供下次幂等判断）', async () => {
      const doneRun = makeHeadedRun({
        phase: 'done',
        completed_at: new Date(Date.now() - 31 * 60 * 1000),
        tmux_killed_at: null,
      });

      const pool = {
        query: vi.fn().mockImplementation((sql) => {
          if (/SELECT DISTINCT ON.*initiative_runs/.test(sql)) {
            return Promise.resolve({ rows: [doneRun] });
          }
          if (/SELECT.*FROM tasks WHERE id/.test(sql)) {
            return Promise.resolve({ rows: [makeHeadedTask()] });
          }
          return Promise.resolve({ rows: [] });
        }),
      };

      const deps = {
        pool,
        execFn: vi.fn().mockReturnValue('0'),
        spawnFn: vi.fn(),
      };

      await resumeStalledRelayRuns(deps);

      // 必须有 UPDATE initiative_runs SET tmux_killed_at=NOW()
      const killAtUpdate = deps.pool.query.mock.calls.find(
        ([sql]) => /UPDATE.*initiative_runs.*tmux_killed_at/i.test(sql)
      );
      expect(killAtUpdate, 'tmux_killed_at 必须写入 DB').toBeTruthy();
    });
  });
});
