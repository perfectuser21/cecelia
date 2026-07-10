/**
 * TDD Red — codex headed tmux dispatch
 * Sprint: sprints/07071654-codex-headed-dispatch
 *
 * 测试 mode=headed 新分支逻辑（harness-skill-relay.js）：
 * 1. headed → ssh+tmux 路径（无 docker extraMounts）
 * 2. 缺省/headless → docker 路径零回归
 * 3. claude+headed → ssh+tmux 路径（T6 88e0b448 解锁后，原"400 拒绝"已反转）
 *
 * 这些测试在实现前都应 FAIL（TDD Red 阶段）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawnSkillRelaySession, isSkillRelayTask, _setActiveCodexRelays } from '../../../packages/brain/src/harness-skill-relay.js';

// 静态导入在整个测试文件内共享同一份模块实例，_activeCodexRelays 是模块级计数器，
// 缺省/headless 分支的两个 it 会真实递增它（与生产行为一致）。每个 it 独立断言前重置，
// 避免跨 it 状态污染（与 B2 并发守门合同测试用 _setActiveCodexRelays 复位是同一机制）。
afterEach(() => {
  _setActiveCodexRelays(0);
});

const HEADED_TASK = {
  id: 'aaaabbbb-cccc-dddd-eeee-ffff00002222',
  title: 'headed smoke task',
  payload: {
    orchestrator: 'skill-relay',
    executor: 'codex',
    mode: 'headed',
    sprint_dir: 'sprints/07071654-codex-headed-dispatch',
    journey_id: 'bb8cc561-b3ee-4fec-b74d-2255694bd963',
  },
};

const HEADLESS_TASK = {
  id: 'aaaabbbb-cccc-dddd-eeee-ffff00003333',
  title: 'headless regression task',
  payload: {
    orchestrator: 'skill-relay',
    executor: 'codex',
    // 无 mode 字段 = 缺省 headless
    sprint_dir: 'sprints/07071654-codex-headed-dispatch',
    journey_id: 'bb8cc561-b3ee-4fec-b74d-2255694bd963',
  },
};

function makeHeadedDeps(overrides = {}) {
  return {
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    // headed 不走 spawnFn（docker），走 sshSpawnFn（tmux）
    spawnFn: vi.fn().mockResolvedValue({ containerId: 'should-not-be-called' }),
    sshSpawnFn: vi.fn().mockResolvedValue({ tmuxSession: 'codex-relay-aaaabbbb', pid: 12345 }),
    loadSkill: vi.fn().mockReturnValue('SKILL_CONTENT_MARKER harness-controller 指令全文'),
    ensureWt: vi.fn().mockResolvedValue('/tmp/wt/task-aaaabbbb'),
    resolveAccountFn: vi.fn().mockResolvedValue(undefined),
    tokenFn: vi.fn().mockResolvedValue('gh-token'),
    now: () => new Date('2026-07-07T12:00:00Z'),
    execFn: vi.fn().mockReturnValue(''), // 去重守卫：无存活容器
    ...overrides,
  };
}

describe('mode=headed 路由分支', () => {

  describe('1. headed → ssh+tmux 路径（无 docker extraMounts）', () => {
    it('mode=headed 时 spawnFn(docker) 不被调用，sshSpawnFn(tmux) 被调用', async () => {
      const deps = makeHeadedDeps();
      const r = await spawnSkillRelaySession(HEADED_TASK, deps);

      // TDD Red: 以下断言在 headed 分支实现前 FAIL
      expect(r.ok).toBe(true);
      expect(r.mode).toBe('skill-relay-codex-headed');

      // headed 路径不走 docker spawnFn
      expect(deps.spawnFn).not.toHaveBeenCalled();

      // headed 路径走 sshSpawnFn
      expect(deps.sshSpawnFn).toHaveBeenCalledOnce();
    });

    it('headed spawn 时无 extraMounts（不挂 docker 凭据卷）', async () => {
      const deps = makeHeadedDeps();
      const r = await spawnSkillRelaySession(HEADED_TASK, deps);

      expect(r.ok).toBe(true);
      // headed 模式下 extraMounts 应为空/undefined（不产生 docker 挂载）
      expect(r.extraMounts).toBeFalsy();
    });

    it('headed spawn：initiative_runs 落行 orchestrator_host=skill-relay-codex-headed', async () => {
      const deps = makeHeadedDeps();
      await spawnSkillRelaySession(HEADED_TASK, deps);

      const insertCall = deps.pool.query.mock.calls.find(
        ([sql]) => /INSERT INTO initiative_runs/.test(sql)
      );
      expect(insertCall, 'initiative_runs 必须 INSERT').toBeTruthy();
      const [sql] = insertCall;
      expect(sql).toContain('skill-relay-codex-headed');
    });

    it('headed spawn：prompt 写入宿主文件路径（不含 GITHUB_TOKEN 明文）', async () => {
      const deps = makeHeadedDeps();
      await spawnSkillRelaySession(HEADED_TASK, deps);

      expect(deps.sshSpawnFn).toHaveBeenCalledOnce();
      const sshOpts = deps.sshSpawnFn.mock.calls[0][0];

      // prompt 文件路径符合规约
      expect(sshOpts.promptFile).toMatch(/\/tmp\/cecelia-host-prompts\//);
      expect(sshOpts.promptFile).toContain(HEADED_TASK.id);

      // 禁止 GITHUB_TOKEN 注入进 tmux 命令串（安全规则）
      const tmuxCmd = JSON.stringify(sshOpts);
      expect(tmuxCmd).not.toMatch(/GITHUB_TOKEN/);
    });

    it('headed spawn：tmux session 名遵循 codex-relay-<short8> 规约', async () => {
      const deps = makeHeadedDeps();
      await spawnSkillRelaySession(HEADED_TASK, deps);

      expect(deps.sshSpawnFn).toHaveBeenCalledOnce();
      const sshOpts = deps.sshSpawnFn.mock.calls[0][0];
      // short8 = task.id 去连字符前 8 位 = 'aaaabbbb'
      expect(sshOpts.tmuxSession).toMatch(/^codex-relay-aaaabbbb/);
    });
  });

  describe('2. 缺省/headless → docker 路径零回归', () => {
    it('无 mode 字段的 codex 任务仍走 docker spawnFn（现有路径不变）', async () => {
      const deps = makeHeadedDeps();
      const r = await spawnSkillRelaySession(HEADLESS_TASK, deps);

      expect(r.ok).toBe(true);
      // 缺省路径走 docker
      expect(deps.spawnFn).toHaveBeenCalledOnce();
      // 缺省路径不走 sshSpawnFn
      expect(deps.sshSpawnFn).not.toHaveBeenCalled();
    });

    it('缺省路径 initiative_runs.orchestrator_host 不含 headed 标记', async () => {
      const deps = makeHeadedDeps();
      await spawnSkillRelaySession(HEADLESS_TASK, deps);

      const insertCall = deps.pool.query.mock.calls.find(
        ([sql]) => /INSERT INTO initiative_runs/.test(sql)
      );
      expect(insertCall, 'initiative_runs 必须 INSERT').toBeTruthy();
      const [sql] = insertCall;
      expect(sql).not.toContain('skill-relay-codex-headed');
    });

    it('mode=headless 显式字段 → 同样走 docker 路径（与缺省等价）', async () => {
      const deps = makeHeadedDeps();
      const headlessTask = {
        ...HEADLESS_TASK,
        payload: { ...HEADLESS_TASK.payload, mode: 'headless' },
      };
      const r = await spawnSkillRelaySession(headlessTask, deps);

      expect(r.ok).toBe(true);
      expect(deps.spawnFn).toHaveBeenCalledOnce();
      expect(deps.sshSpawnFn).not.toHaveBeenCalled();
    });
  });
});

describe('3. claude+headed → ssh+tmux 路径（T6 88e0b448 解锁后）', () => {
  /**
   * T6（88e0b448，routing-doctrine：Claude=有头）解锁 claude+headed 派发后，
   * routes/tasks.js 入口白名单已放行 executor=claude + mode=headed；
   * spawnSkillRelaySession 层同步泛化，走 _spawnHeadedSession 的 ssh+tmux 路径，
   * host 值/tmux 前缀按 HEADED_HOSTS.claude / HEADED_TMUX_PREFIXES.claude 映射。
   * 本用例原为"claude+headed 应被拒绝"的防御层测试，随此次策略反转同步更新。
   */
  it('executor=claude + mode=headed → spawnSkillRelaySession 返回 ok=true，走 sshSpawnFn（不走 docker）', async () => {
    const deps = makeHeadedDeps();
    const claudeHeadedTask = {
      id: 'aaaabbbb-cccc-dddd-eeee-ffff00004444',
      title: 'claude headed valid',
      payload: {
        orchestrator: 'skill-relay',
        executor: 'claude',
        mode: 'headed',
        sprint_dir: 'sprints/07071654-codex-headed-dispatch',
        journey_id: 'bb8cc561-b3ee-4fec-b74d-2255694bd963',
      },
    };
    const r = await spawnSkillRelaySession(claudeHeadedTask, deps);

    expect(r.ok).toBe(true);
    expect(r.mode).toBe('skill-relay-claude-headed');
    // claude headed 路径同样不走 docker，走 tmux
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(deps.sshSpawnFn).toHaveBeenCalledOnce();
  });
});

describe('4. ssh spawn 失败 → B4 回滚（ALERT + 回 queued）', () => {
  it('sshSpawnFn 抛错 → ok=false，task 状态回滚至 queued（与 docker 路径对齐）', async () => {
    const deps = makeHeadedDeps({
      sshSpawnFn: vi.fn().mockRejectedValue(new Error('ssh: connection refused')),
    });
    const r = await spawnSkillRelaySession(HEADED_TASK, deps);

    expect(r.ok).toBe(false);
    expect(r.error).toContain('ssh');

    // 回滚：UPDATE tasks SET status='queued'
    const rollbackCall = deps.pool.query.mock.calls.find(
      ([sql]) => /UPDATE tasks.*status.*queued/i.test(sql)
    );
    expect(rollbackCall, 'ssh 失败时必须回滚 task 到 queued').toBeTruthy();
  });
});
