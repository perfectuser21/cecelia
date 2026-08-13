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
    id: '10000000-0000-4000-8000-000000000007',
    initiative_id: 'bbbbcccc-dddd-eeee-ffff-000011112222',
    current_task_id: 'bbbbcccc-dddd-eeee-ffff-000011112222',
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
      if (/FROM initiative_runs r/.test(sql)) {
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

  it('kernel-v1 headed tmux 存活时以原 Controller generation 续租而不转成 headless',async()=>{
    const controllerSessionId='99999999-9999-4999-8999-999999999999';
    const run=makeHeadedRun({
      phase:'planning',
      controller_session_id:controllerSessionId,
      controller_generation:'4',
    });
    const task=makeHeadedTask({
      payload:{...makeHeadedTask().payload,harness_runtime:'kernel-v1'},
    });
    const pool={query:vi.fn(async(sql)=>{
      if (/FROM initiative_runs r/.test(sql)) return {rows:[run]};
      if (/SELECT.*FROM tasks WHERE id/.test(sql)) return {rows:[task]};
      if (/FROM harness_attempts/.test(sql)) return {rows:[]};
      return {rows:[]};
    })};
    const writeControllerHeartbeat=vi.fn(async()=>{});
    const launchKernel=vi.fn(async()=>({pid:123}));
    const execFn=vi.fn(()=> 'TMUX_ALIVE');

    await resumeStalledRelayRuns({
      pool,execFn,writeControllerHeartbeat,launchKernel,
      now:()=>new Date('2026-08-13T10:00:00.000Z'),
      hostname:()=> 'watchdog-host',watchdogPid:4321,
    });

    expect(execFn).toHaveBeenCalledWith(expect.stringContaining('tmux has-session'));
    expect(writeControllerHeartbeat).toHaveBeenCalledWith(pool,expect.objectContaining({
      runId:run.id,controllerSessionId,controllerGeneration:4,
      host:'headed-watchdog:watchdog-host',pid:4321,
    }));
    expect(launchKernel).not.toHaveBeenCalled();
  });

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

    it('headed run phase=gan(relay 真实 phase)+ session 消失 → 触发重点火（存活检测写死 A_planning 漏掉 gan/generate = RED）', async () => {
      const run = makeHeadedRun({ phase: 'gan' });
      const task = makeHeadedTask();
      const pool = {
        query: vi.fn().mockImplementation((sql) => {
          if (/FROM initiative_runs r/.test(sql)) return Promise.resolve({ rows: [run] });
          if (/SELECT.*FROM tasks WHERE id/.test(sql)) return Promise.resolve({ rows: [task] });
          return Promise.resolve({ rows: [] });
        }),
      };
      const execFn = vi.fn().mockImplementation((cmd) => {
        if (cmd.includes('tmux has-session')) {
          const err = new Error("can't find session codex-relay-bbbbcccc");
          err.status = 1; // session 不存在（exit 1，非 ssh 连接失败）
          throw err;
        }
        return '0';
      });
      const spawnFn = vi.fn().mockResolvedValue({ ok: true, containerId: 'cid' });

      const result = await resumeStalledRelayRuns({ pool, execFn, spawnFn });

      // relay 真实 phase 是 planning/gan/generate，不是旧 LangGraph 图的 A_planning；
      // gan 阶段 session 消失也必须重点火，否则中途死的 headed session 永远无人救。
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
          if (/FROM initiative_runs r/.test(sql)) {
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
          if (/FROM initiative_runs r/.test(sql)) {
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

    it('claude headed run phase=done 超 30min → kill-session 用 claude-relay- 前缀收窗', async () => {
      const killCmds = [];
      const doneClaudeRun = makeHeadedRun({
        orchestrator_host: 'skill-relay-claude-headed',
        phase: 'done',
        completed_at: new Date(Date.now() - 31 * 60 * 1000), // 31 分钟前完成
        tmux_killed_at: null, // 尚未收窗
      });
      const claudeTask = makeHeadedTask({
        payload: {
          orchestrator: 'skill-relay',
          executor: 'claude',
          mode: 'headed',
          ssh_host: 'localhost',
          sprint_dir: 'sprints/07071654-codex-headed-dispatch',
        },
      });

      const pool = {
        query: vi.fn().mockImplementation((sql) => {
          if (/FROM initiative_runs r/.test(sql)) {
            return Promise.resolve({ rows: [doneClaudeRun] });
          }
          if (/SELECT.*FROM tasks WHERE id/.test(sql)) {
            return Promise.resolve({ rows: [claudeTask] });
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

      await resumeStalledRelayRuns(deps);

      expect(killCmds.length).toBeGreaterThan(0);
      expect(killCmds[0]).toContain('kill-session');
      expect(killCmds[0]).toContain('claude-relay-');
    });

    it('收窗后 DB 写入 tmux_killed_at 时间戳（供下次幂等判断）', async () => {
      const doneRun = makeHeadedRun({
        phase: 'done',
        completed_at: new Date(Date.now() - 31 * 60 * 1000),
        tmux_killed_at: null,
      });

      const pool = {
        query: vi.fn().mockImplementation((sql) => {
          if (/FROM initiative_runs r/.test(sql)) {
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

  describe('claude headed run（T6）', () => {
    it('orchestrator_host=skill-relay-claude-headed 的 run 被扫描，tmux 检查用 claude-relay- 前缀', async () => {
      // 照本文件"codex headed A_planning session 存活"用例复制，改两点：
      // ① runsQ 返回行 orchestrator_host: 'skill-relay-claude-headed'
      // ② 断言 execFn 收到的 tmux has-session 命令含 'claude-relay-'
      const cmds = [];
      const claudeRun = makeHeadedRun({ orchestrator_host: 'skill-relay-claude-headed' });
      const claudeTask = makeHeadedTask({
        payload: {
          orchestrator: 'skill-relay',
          executor: 'claude',
          mode: 'headed',
          ssh_host: 'localhost',
          sprint_dir: 'sprints/07071654-codex-headed-dispatch',
        },
      });

      const pool = {
        query: vi.fn().mockImplementation((sql) => {
          if (/FROM initiative_runs r/.test(sql)) {
            return Promise.resolve({ rows: [claudeRun] });
          }
          if (/SELECT.*FROM tasks WHERE id/.test(sql)) {
            return Promise.resolve({ rows: [claudeTask] });
          }
          return Promise.resolve({ rows: [] });
        }),
      };

      const deps = {
        pool,
        execFn: vi.fn().mockImplementation((cmd) => {
          cmds.push(cmd);
          return '0'; // has-session exit 0 → session 存活，不重点火
        }),
        spawnFn: vi.fn(),
      };

      await resumeStalledRelayRuns(deps);

      const hasSessionCmd = cmds.find((c) => c.includes('tmux has-session'));
      expect(hasSessionCmd, 'claude headed run 必须走 tmux 存活检测').toBeTruthy();
      expect(hasSessionCmd).toContain('claude-relay-');
      // session 存活 → 不重点火
      expect(deps.spawnFn).not.toHaveBeenCalled();
    });
  });
});
