/**
 * TDD Red — codex headed tmux dispatch
 * Sprint: sprints/07071654-codex-headed-dispatch
 *
 * 测试 mode=headed 新分支逻辑（harness-skill-relay.js）：
 * 1. headed → ssh+tmux 路径（无 docker extraMounts）
 * 2. 缺省/headless → docker 路径零回归
 * 3. claude+headed → 400 拒绝
 *
 * 这些测试在实现前都应 FAIL（TDD Red 阶段）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSkillRelaySession, isSkillRelayTask, _setActiveCodexRelays } from '../harness-skill-relay.js';

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

describe('3. claude+headed → 拒绝路由', () => {
  /**
   * 注意：claude+headed 的拒绝发生在 routes/tasks.js（POST /api/brain/tasks 入口）层，
   * 不是在 spawnSkillRelaySession 层。
   * 这里测试 spawnSkillRelaySession 对 claude+headed 的防御性处理。
   */
  it('executor=claude + mode=headed → spawnSkillRelaySession 返回 ok=false（防御层）', async () => {
    const deps = makeHeadedDeps();
    const claudeHeadedTask = {
      id: 'aaaabbbb-cccc-dddd-eeee-ffff00004444',
      title: 'claude headed invalid',
      payload: {
        orchestrator: 'skill-relay',
        executor: 'claude',
        mode: 'headed',
        sprint_dir: 'sprints/07071654-codex-headed-dispatch',
      },
    };
    const r = await spawnSkillRelaySession(claudeHeadedTask, deps);

    // TDD Red: claude+headed 组合不合法，应被拒绝
    expect(r.ok).toBe(false);
    expect(r.error || r.reason).toBeTruthy();
    // 不应产生任何 spawn
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(deps.sshSpawnFn).not.toHaveBeenCalled();
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

/**
 * 五连雷返修回归（task b2fdfd2b，首航 bc2b3ace 实证 spawn 即炸）：
 * 之前的测试全部注入 sshSpawnFn（测试专用路径），从未真正跑过生产用的
 * execFn 降级路径（无 sshSpawnFn 注入时的 real ssh 分支），把 ESM require 崩溃
 * 等一系列生产 bug 全部藏住了。以下用例强制走 execFn 降级路径，覆盖生产真实形状。
 */
describe('5. 五连雷返修回归（execFn 降级路径 = 生产真实路径）', () => {
  function makeNoSshDeps(overrides = {}) {
    return {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({ containerId: 'should-not-be-called' }),
      sshSpawnFn: undefined, // 强制走 execFn 降级路径（生产真实形状）
      loadSkill: vi.fn().mockReturnValue('SKILL_CONTENT_MARKER harness-controller 指令全文'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt/task-aaaabbbb'),
      resolveAccountFn: vi.fn().mockResolvedValue(undefined),
      tokenFn: vi.fn().mockResolvedValue('gh-token'),
      now: () => new Date('2026-07-07T12:00:00Z'),
      execFn: vi.fn().mockReturnValue(''),
      ...overrides,
    };
  }

  describe('雷1：ESM require 崩溃', () => {
    it('源码不含 require( 调用（ESM 纯度守卫，防复发）', () => {
      const filePath = fileURLToPath(new URL('../harness-skill-relay.js', import.meta.url));
      const source = readFileSync(filePath, 'utf8');
      expect(source).not.toMatch(/\brequire\(/);
    });
  });

  describe('雷2：prompt 内联引号炸弹 → 改 ssh stdin 交付', () => {
    it('无 sshSpawnFn 时，prompt 通过 execFn stdin(input) 写入，不用 printf/JSON 内联', async () => {
      const calls = [];
      const execFn = vi.fn((cmd, opts) => { calls.push({ cmd, opts }); return ''; });
      const deps = makeNoSshDeps({ execFn });

      const r = await spawnSkillRelaySession(HEADED_TASK, deps);
      expect(r.ok).toBe(true);

      const writeCall = calls.find((c) => /mkdir -p \/tmp\/cecelia-host-prompts/.test(c.cmd));
      expect(writeCall, 'prompt 写入命令必须出现').toBeTruthy();
      expect(writeCall.cmd).toContain('cat >');
      expect(writeCall.cmd).not.toContain('printf');
      expect(writeCall.cmd).not.toMatch(/JSON\.stringify/);
      expect(writeCall.opts?.input).toBeTruthy();
      expect(writeCall.opts.input).toContain('SKILL_CONTENT_MARKER');
    });
  });

  describe('雷3：编造的 --prompt-file flag → 改远端 $(cat) 展开', () => {
    it('tmux pane 命令用 codex "$(cat <promptFile>)"，不含 --prompt-file', async () => {
      const calls = [];
      const execFn = vi.fn((cmd, opts) => { calls.push({ cmd, opts }); return ''; });
      const deps = makeNoSshDeps({ execFn });

      const r = await spawnSkillRelaySession(HEADED_TASK, deps);
      expect(r.ok).toBe(true);

      const tmuxCall = calls.find((c) => /tmux new-session/.test(c.cmd));
      expect(tmuxCall, 'tmux new-session 命令必须出现').toBeTruthy();
      expect(tmuxCall.cmd).not.toContain('--prompt-file');
      expect(tmuxCall.cmd).toMatch(/codex .*\\?"\\?\$\(cat /);
    });
  });

  describe('雷4：缺 worktree → codex 在宿主 $HOME 裸奔', () => {
    it('headed 分支调用 ensureWt 建 worktree，tmux 命令 cd 进该路径', async () => {
      const calls = [];
      const execFn = vi.fn((cmd, opts) => { calls.push({ cmd, opts }); return ''; });
      const deps = makeNoSshDeps({ execFn });

      const r = await spawnSkillRelaySession(HEADED_TASK, deps);
      expect(r.ok).toBe(true);

      expect(deps.ensureWt).toHaveBeenCalledOnce();
      expect(deps.ensureWt).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: HEADED_TASK.id })
      );

      const tmuxCall = calls.find((c) => /tmux new-session/.test(c.cmd));
      expect(tmuxCall).toBeTruthy();
      expect(tmuxCall.cmd).toContain('cd /tmp/wt/task-aaaabbbb');
    });
  });

  describe('雷5：缺 CODEX_HOME 注入 → 烧宿主默认账号', () => {
    const ORIGINAL_CODEX_RELAY_HOME = process.env.CODEX_RELAY_HOME;

    afterEach(() => {
      if (ORIGINAL_CODEX_RELAY_HOME === undefined) {
        delete process.env.CODEX_RELAY_HOME;
      } else {
        process.env.CODEX_RELAY_HOME = ORIGINAL_CODEX_RELAY_HOME;
      }
    });

    it('CODEX_RELAY_HOME 已配置时，tmux pane 命令注入 CODEX_HOME=<值>', async () => {
      process.env.CODEX_RELAY_HOME = '/Users/administrator/.codex-team2';
      const calls = [];
      const execFn = vi.fn((cmd, opts) => { calls.push({ cmd, opts }); return ''; });
      const deps = makeNoSshDeps({ execFn });

      const r = await spawnSkillRelaySession(HEADED_TASK, deps);
      expect(r.ok).toBe(true);

      const tmuxCall = calls.find((c) => /tmux new-session/.test(c.cmd));
      expect(tmuxCall).toBeTruthy();
      expect(tmuxCall.cmd).toContain('CODEX_HOME=/Users/administrator/.codex-team2');
    });

    it('CODEX_RELAY_HOME 显式配置为空字符串时，headed 分支 loud-fail（不绕过 B6 门禁）', async () => {
      process.env.CODEX_RELAY_HOME = '';
      const deps = makeNoSshDeps();

      const r = await spawnSkillRelaySession(HEADED_TASK, deps);

      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/CODEX_RELAY_HOME/);
      // 门禁在 spawn 任何东西之前拦截
      expect(deps.ensureWt).not.toHaveBeenCalled();
    });
  });
});

/**
 * 雷6：ssh 目标容器内错配（R2 首航 8e2bbaef 实证）。
 * brain 跑在容器里时，默认 'ssh localhost' 连到容器自己（无 sshd）→ Connection refused。
 * 修法对齐 spawn/host-executor.js 先例：/.dockerenv 存在 → administrator@host.docker.internal，
 * 且 ssh 必须带 BatchMode/StrictHostKeyChecking/UserKnownHostsFile 三件套（非交互环境）。
 */
describe('6. 雷6：ssh 目标容器感知 + 非交互 flags', () => {
  function makeNoSshDeps(overrides = {}) {
    return {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({ containerId: 'should-not-be-called' }),
      sshSpawnFn: undefined,
      loadSkill: vi.fn().mockReturnValue('SKILL_CONTENT_MARKER'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt/task-aaaabbbb'),
      resolveAccountFn: vi.fn().mockResolvedValue(undefined),
      tokenFn: vi.fn().mockResolvedValue('gh-token'),
      now: () => new Date('2026-07-07T12:00:00Z'),
      execFn: vi.fn().mockReturnValue(''),
      ...overrides,
    };
  }

  it('容器内（inDockerFn=true）→ ssh 目标 administrator@host.docker.internal + BatchMode 三件套', async () => {
    const calls = [];
    const execFn = vi.fn((cmd, opts) => { calls.push({ cmd, opts }); return ''; });
    const deps = makeNoSshDeps({ execFn, inDockerFn: () => true });
    const r = await spawnSkillRelaySession(HEADED_TASK, deps);
    expect(r.ok).toBe(true);
    const sshCalls = calls.filter((c) => /^ssh /.test(c.cmd));
    expect(sshCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of sshCalls) {
      expect(c.cmd).toContain('administrator@host.docker.internal');
      expect(c.cmd).toContain('-o BatchMode=yes');
      expect(c.cmd).toContain('-o StrictHostKeyChecking=no');
      expect(c.cmd).toContain('-o UserKnownHostsFile=/dev/null');
      expect(c.cmd).not.toMatch(/ssh (-o [^ ]+ )*localhost/);
    }
  });

  it('非容器（inDockerFn=false）→ 默认 localhost（宿主直跑场景）', async () => {
    const calls = [];
    const execFn = vi.fn((cmd, opts) => { calls.push({ cmd, opts }); return ''; });
    const deps = makeNoSshDeps({ execFn, inDockerFn: () => false });
    const r = await spawnSkillRelaySession(HEADED_TASK, deps);
    expect(r.ok).toBe(true);
    const sshCalls = calls.filter((c) => /^ssh /.test(c.cmd));
    expect(sshCalls.some((c) => c.cmd.includes('localhost'))).toBe(true);
  });

  it('payload.ssh_host 显式指定时永远赢', async () => {
    const calls = [];
    const execFn = vi.fn((cmd, opts) => { calls.push({ cmd, opts }); return ''; });
    const deps = makeNoSshDeps({ execFn, inDockerFn: () => true });
    const task = { ...HEADED_TASK, payload: { ...HEADED_TASK.payload, ssh_host: 'me@custom-host' } };
    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(true);
    const sshCalls = calls.filter((c) => /^ssh /.test(c.cmd));
    expect(sshCalls.every((c) => c.cmd.includes('me@custom-host'))).toBe(true);
  });
});

/**
 * 雷7：ssh 缺 -i 私钥（R3 首航 dd9642d8 实证 Permission denied）。
 * compose 把宿主 ~/.ssh 以同路径 :ro 挂进容器，host-executor.js 靠候选列表发现 key 并传 -i；
 * headed 分支必须同样传 -i（deps.sshKeyFn 可注入，env HEADED_SSH_KEY 可覆盖）。
 */
describe('7. 雷7：ssh 私钥自动发现（-i）', () => {
  function makeNoSshDeps(overrides = {}) {
    return {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({ containerId: 'should-not-be-called' }),
      sshSpawnFn: undefined,
      loadSkill: vi.fn().mockReturnValue('SKILL_CONTENT_MARKER'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt/task-aaaabbbb'),
      resolveAccountFn: vi.fn().mockResolvedValue(undefined),
      tokenFn: vi.fn().mockResolvedValue('gh-token'),
      now: () => new Date('2026-07-07T12:00:00Z'),
      execFn: vi.fn().mockReturnValue(''),
      ...overrides,
    };
  }

  it('sshKeyFn 发现到 key 时，所有 ssh 调用带 -i <key>', async () => {
    const calls = [];
    const execFn = vi.fn((cmd, opts) => { calls.push({ cmd, opts }); return ''; });
    const deps = makeNoSshDeps({ execFn, inDockerFn: () => true, sshKeyFn: () => '/fake/.ssh/id_ed25519' });
    const r = await spawnSkillRelaySession(HEADED_TASK, deps);
    expect(r.ok).toBe(true);
    const sshCalls = calls.filter((c) => /^ssh /.test(c.cmd));
    expect(sshCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of sshCalls) {
      expect(c.cmd).toContain('-i /fake/.ssh/id_ed25519');
    }
  });

  it('sshKeyFn 未发现 key 时不加 -i（宿主直跑用默认 key 链）', async () => {
    const calls = [];
    const execFn = vi.fn((cmd, opts) => { calls.push({ cmd, opts }); return ''; });
    const deps = makeNoSshDeps({ execFn, inDockerFn: () => false, sshKeyFn: () => null });
    const r = await spawnSkillRelaySession(HEADED_TASK, deps);
    expect(r.ok).toBe(true);
    const sshCalls = calls.filter((c) => /^ssh /.test(c.cmd));
    expect(sshCalls.every((c) => !c.cmd.includes(' -i '))).toBe(true);
  });
});

/**
 * 雷9：codex TUI 首次进新目录卡"Do you trust the contents of this directory?"交互确认
 * （R4 首航靠人工 send-keys Enter 放行）。trust 记忆按精确 worktree 路径写进
 * $CODEX_HOME/config.toml 的 [projects."<dir>"]——每条 harness worktree 都是新路径，
 * 必须在起 tmux 之前经同一条 ssh 通道幂等预写，否则每次首航都卡门。
 */
describe('8. 雷9：codex trust 预写（config.toml [projects.] 幂等预写）', () => {
  function makeNoSshDeps(overrides = {}) {
    return {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({ containerId: 'should-not-be-called' }),
      sshSpawnFn: undefined,
      loadSkill: vi.fn().mockReturnValue('SKILL_CONTENT_MARKER'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt/task-aaaabbbb'),
      resolveAccountFn: vi.fn().mockResolvedValue(undefined),
      tokenFn: vi.fn().mockResolvedValue('gh-token'),
      now: () => new Date('2026-07-07T12:00:00Z'),
      execFn: vi.fn().mockReturnValue(''),
      ...overrides,
    };
  }

  const ORIGINAL_CODEX_RELAY_HOME = process.env.CODEX_RELAY_HOME;
  afterEach(() => {
    if (ORIGINAL_CODEX_RELAY_HOME === undefined) {
      delete process.env.CODEX_RELAY_HOME;
    } else {
      process.env.CODEX_RELAY_HOME = ORIGINAL_CODEX_RELAY_HOME;
    }
  });

  it('CODEX_RELAY_HOME 已配置：起 tmux 之前存在一条含 config.toml + worktree 路径 + trust_level + grep 幂等判断的 ssh 调用', async () => {
    process.env.CODEX_RELAY_HOME = '/Users/administrator/.codex-team2';
    const calls = [];
    const execFn = vi.fn((cmd, opts) => { calls.push({ cmd, opts }); return ''; });
    const deps = makeNoSshDeps({ execFn });

    const r = await spawnSkillRelaySession(HEADED_TASK, deps);
    expect(r.ok).toBe(true);

    const trustCallIdx = calls.findIndex((c) => c.cmd.includes('config.toml'));
    expect(trustCallIdx, 'trust preseed ssh 调用必须出现').toBeGreaterThanOrEqual(0);
    const trustCall = calls[trustCallIdx];
    expect(trustCall.cmd).toContain('/Users/administrator/.codex-team2/config.toml');
    expect(trustCall.cmd).toContain('/tmp/wt/task-aaaabbbb'); // worktree 路径
    expect(trustCall.cmd).toContain('trust_level');
    expect(trustCall.cmd).toMatch(/grep -qF/); // 幂等判断

    // 必须发生在 tmux new-session 之前
    const tmuxCallIdx = calls.findIndex((c) => /tmux new-session/.test(c.cmd));
    expect(tmuxCallIdx, 'tmux new-session 命令必须出现').toBeGreaterThanOrEqual(0);
    expect(trustCallIdx).toBeLessThan(tmuxCallIdx);
  });

  it('CODEX_RELAY_HOME 未配置：跳过 trust preseed（不产生 config.toml ssh 调用），不影响 spawn 成功', async () => {
    delete process.env.CODEX_RELAY_HOME;
    const calls = [];
    const execFn = vi.fn((cmd, opts) => { calls.push({ cmd, opts }); return ''; });
    const deps = makeNoSshDeps({ execFn });

    const r = await spawnSkillRelaySession(HEADED_TASK, deps);
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.cmd.includes('config.toml'))).toBe(false);
  });

  it('trust preseed 命令本身对不存在的 config.toml 幂等跳过（不硬造文件）', async () => {
    process.env.CODEX_RELAY_HOME = '/Users/administrator/.codex-team2';
    const calls = [];
    const execFn = vi.fn((cmd, opts) => { calls.push({ cmd, opts }); return ''; });
    const deps = makeNoSshDeps({ execFn });

    const r = await spawnSkillRelaySession(HEADED_TASK, deps);
    expect(r.ok).toBe(true);

    const trustCall = calls.find((c) => c.cmd.includes('config.toml'));
    expect(trustCall).toBeTruthy();
    // 远端脚本必须先判存在再写，不存在时不落盘（不能无条件 printf >> ）
    expect(trustCall.cmd).toMatch(/if \[ -f .*config\.toml \]; then/);
  });

  it('trust preseed 失败（ssh 报错）不阻断 headed spawn（non-fatal，交给 codex 自行处理交互确认）', async () => {
    process.env.CODEX_RELAY_HOME = '/Users/administrator/.codex-team2';
    let call = 0;
    const execFn = vi.fn((cmd) => {
      call += 1;
      if (cmd.includes('config.toml')) {
        throw new Error('ssh: connection reset');
      }
      return '';
    });
    const deps = makeNoSshDeps({ execFn });

    const r = await spawnSkillRelaySession(HEADED_TASK, deps);
    expect(r.ok).toBe(true);
  });
});

/**
 * 雷10→雷12（主理人 2026-07-08 改判）：headed 模式 tmux 起 codex TUI 时，
 * 原 -a never -s workspace-write 压不住 GitHub MCP 插件建分支的批准框（MCP 工具批准
 * 独立于 -a never 的另一层）。逐个预置 permission 是打地鼠——改用整体 bypass：
 * --dangerously-bypass-approvals-and-sandbox（codex 版 bypass permissions，一个 flag
 * 跳过 trust 确认 + shell 命令批准 + GitHub MCP 工具批准），与无头 docker 里 claude 的
 * --dangerously-skip-permissions 对等——worktree 隔离（cp 分支）+ 有头可 esc 打断，
 * 是"externally sandboxed 受控环境"，适用场景成立。
 */
describe('9. 雷12：headed codex TUI 批准框（含 GitHub MCP）→ 整体 bypass flag', () => {
  function makeNoSshDeps(overrides = {}) {
    return {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({ containerId: 'should-not-be-called' }),
      sshSpawnFn: undefined,
      loadSkill: vi.fn().mockReturnValue('SKILL_CONTENT_MARKER'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt/task-aaaabbbb'),
      resolveAccountFn: vi.fn().mockResolvedValue(undefined),
      tokenFn: vi.fn().mockResolvedValue('gh-token'),
      now: () => new Date('2026-07-07T12:00:00Z'),
      execFn: vi.fn().mockReturnValue(''),
      ...overrides,
    };
  }

  it('tmux new-session 命令含 codex --dangerously-bypass-approvals-and-sandbox（不再含 -a never）', async () => {
    const calls = [];
    const execFn = vi.fn((cmd, opts) => { calls.push({ cmd, opts }); return ''; });
    const deps = makeNoSshDeps({ execFn });

    const r = await spawnSkillRelaySession(HEADED_TASK, deps);
    expect(r.ok).toBe(true);

    const tmuxCall = calls.find((c) => /tmux new-session/.test(c.cmd));
    expect(tmuxCall, 'tmux new-session 命令必须出现').toBeTruthy();
    expect(tmuxCall.cmd).toContain('codex --dangerously-bypass-approvals-and-sandbox');
    expect(tmuxCall.cmd).not.toMatch(/-a never/);
    expect(tmuxCall.cmd).not.toMatch(/-s workspace-write/);
  });
});

/**
 * 雷11：Brain 重启后 startup-sync 误把 skill-relay 当 LangGraph requeue（executor.js
 * 已在另一测试文件 executor-startup-sync.test.js 覆盖），dispatcher 重新 claim 后再次调
 * spawnSkillRelaySession（headed 分支）——若旧 tmux session 仍存活（R5 首航实证：Brain
 * 重启但宿主 tmux 未死），会撞名 `tmux new-session` 报错，第二次 spawn 失败标 task=failed，
 * 而第一次的真 session 还活着，无人知道。对齐无头 docker 分支既有的
 * `docker ps -q --filter name=cecelia-relay-<short>` 去重守卫（同一函数内 headless
 * 分支已有），headed 分支必须补一条 `tmux has-session` 存活守卫：命中（exit 0）→
 * 不重复 spawn，返回 deferred。
 */
describe('10. 雷11：headed tmux 去重守卫（防 Brain 重启后双 spawn 撞名）', () => {
  function makeNoSshDeps(overrides = {}) {
    return {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({ containerId: 'should-not-be-called' }),
      sshSpawnFn: undefined,
      loadSkill: vi.fn().mockReturnValue('SKILL_CONTENT_MARKER'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt/task-aaaabbbb'),
      resolveAccountFn: vi.fn().mockResolvedValue(undefined),
      tokenFn: vi.fn().mockResolvedValue('gh-token'),
      now: () => new Date('2026-07-07T12:00:00Z'),
      execFn: vi.fn().mockReturnValue(''),
      ...overrides,
    };
  }

  it('tmux has-session 存活（stdout=TMUX_ALIVE）→ 不重复 spawn，返回 deferred，不写 prompt/不起新 tmux', async () => {
    const calls = [];
    const execFn = vi.fn((cmd) => {
      calls.push(cmd);
      if (/tmux has-session -t codex-relay-aaaabbbb/.test(cmd)) {
        return 'TMUX_ALIVE'; // 远端 shell && / || 已把 exit code 转成 stdout 字符串
      }
      return '';
    });
    const deps = makeNoSshDeps({ execFn });

    const r = await spawnSkillRelaySession(HEADED_TASK, deps);

    expect(r.ok).toBe(false);
    expect(r.deferred).toBe(true);
    expect(r.reason).toBe('live_tmux_guard');

    // 存活守卫命中后不应再起新 tmux session，也不应写 prompt 文件
    expect(calls.some((c) => /tmux new-session/.test(c))).toBe(false);
    expect(calls.some((c) => /mkdir -p \/tmp\/cecelia-host-prompts/.test(c))).toBe(false);
    // 不应调用 ensureWt（守卫在建 worktree 之前拦截，省资源）
    expect(deps.ensureWt).not.toHaveBeenCalled();
  });

  it('tmux has-session 未存活（stdout=TMUX_DEAD）→ 正常继续 spawn', async () => {
    const calls = [];
    const execFn = vi.fn((cmd) => {
      calls.push(cmd);
      if (/tmux has-session -t codex-relay-aaaabbbb/.test(cmd)) {
        return 'TMUX_DEAD';
      }
      return '';
    });
    const deps = makeNoSshDeps({ execFn });

    const r = await spawnSkillRelaySession(HEADED_TASK, deps);

    expect(r.ok).toBe(true);
    expect(calls.some((c) => /tmux new-session/.test(c))).toBe(true);
  });

  it('tmux 存活检查 ssh 本身抛错（连接失败）→ fail-open，正常继续 spawn', async () => {
    const calls = [];
    const execFn = vi.fn((cmd) => {
      calls.push(cmd);
      if (/tmux has-session -t codex-relay-aaaabbbb/.test(cmd)) {
        throw new Error('ssh: connect to host localhost port 22: Connection refused');
      }
      return '';
    });
    const deps = makeNoSshDeps({ execFn });

    const r = await spawnSkillRelaySession(HEADED_TASK, deps);

    expect(r.ok).toBe(true);
    expect(calls.some((c) => /tmux new-session/.test(c))).toBe(true);
  });

  it('去重守卫命中时不写 initiative_runs INSERT（未真正 spawn，不产生新 run 行）', async () => {
    const execFn = vi.fn((cmd) => {
      if (/tmux has-session -t codex-relay-aaaabbbb/.test(cmd)) return 'TMUX_ALIVE';
      return '';
    });
    const poolQuery = vi.fn().mockResolvedValue({ rows: [] });
    const deps = makeNoSshDeps({ execFn, pool: { query: poolQuery } });

    await spawnSkillRelaySession(HEADED_TASK, deps);

    const insertCall = poolQuery.mock.calls.find(
      ([sql]) => /INSERT INTO initiative_runs/.test(sql)
    );
    expect(insertCall).toBeFalsy();
  });
});
