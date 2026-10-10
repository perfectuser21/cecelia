/**
 * Claude 无头通道下线 —— Brain 内各启动层（任务 76a160b3）
 *
 * 子进程边界全部替换成「一调就炸」：本文件任何用例都不可能真的拉起 claude / ssh / docker。
 */
const { BOOM } = vi.hoisted(() => ({ BOOM: () => { throw new Error('测试禁止启动子进程'); } }));
vi.mock('child_process', async (original) => ({ ...await original(), spawn: vi.fn(BOOM), spawnSync: vi.fn(BOOM), execFile: vi.fn(BOOM), execSync: vi.fn(BOOM), exec: vi.fn(BOOM) }));
vi.mock('node:child_process', async (original) => ({ ...await original(), spawn: vi.fn(BOOM), spawnSync: vi.fn(BOOM), execFile: vi.fn(BOOM), execSync: vi.fn(BOOM), exec: vi.fn(BOOM) }));
vi.mock('../runtime-safety.js', async (original) => ({ ...await original(), assertExternalExecutionAllowed: () => {} }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as nodeChild from 'node:child_process';

const RETIRED = /claude_channel_retired/;
beforeEach(() => vi.clearAllMocks());

describe('spawn 层：claude 一律拒绝，不发起 SSH', () => {
  it('executeOnHost（mac_web 宿主执行，唯一用途是跑 claude）直接拒绝，不调用 spawnFn', async () => {
    const { executeOnHost } = await import('../spawn/host-executor.js');
    const spawnFn = vi.fn(BOOM);
    for (const inContainer of [true, false]) {
      await expect(executeOnHost({ task: { id: 't-host' }, prompt: 'p', spawnFn, inContainer })).rejects.toThrow(RETIRED);
    }
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('spawn()：mac_web 任务拒绝', async () => {
    vi.stubEnv('SPAWN_V2_ENABLED', 'false');
    try {
      const { spawn } = await import('../spawn/spawn.js');
      await expect(spawn({ task: { id: 't-mac', payload: { target_environment: 'mac_web' } }, prompt: 'p' })).rejects.toThrow(RETIRED);
    } finally { vi.unstubAllEnvs(); }
  });

  it.each([[undefined], [''], ['claude']])('spawn()：容器执行体=%s（即 claude）拒绝', async (executor) => {
    vi.stubEnv('SPAWN_V2_ENABLED', 'false');
    try {
      const { spawn } = await import('../spawn/spawn.js');
      const env = executor === undefined ? {} : { CECELIA_EXECUTOR: executor };
      await expect(spawn({ task: { id: 't-docker' }, prompt: 'p', env })).rejects.toThrow(RETIRED);
    } finally { vi.unstubAllEnvs(); }
  });

  it.each([[undefined], ['claude']])('spawnDockerDetached：容器执行体=%s 拒绝，不写 prompt、不 docker run', async (executor) => {
    const { spawnDockerDetached } = await import('../spawn/detached.js');
    const env = executor === undefined ? {} : { CECELIA_EXECUTOR: executor };
    await expect(spawnDockerDetached({ task: { id: 't-det' }, prompt: 'p', containerId: 'c-det', env })).rejects.toThrow(RETIRED);
    expect(nodeChild.spawn).not.toHaveBeenCalled();
  });
});

describe('commander-invoker：默认 runner 不再执行 claude -p', () => {
  it('createCommanderSession 未注入 runner → claude_channel_retired，不 execFile', async () => {
    const { createCommanderSession } = await import('../orchestrator/commander-invoker.js');
    await expect(createCommanderSession({ runId: 'r', taskRequest: 't', gear: 'bugfix' })).rejects.toThrow(RETIRED);
    expect(nodeChild.execFile).not.toHaveBeenCalled();
  });

  it('wakeCommander 未注入 runner → commander_wake_failed 带 claude_channel_retired（调用方既有降级③升人）', async () => {
    const { wakeCommander } = await import('../orchestrator/commander-invoker.js');
    await expect(wakeCommander({ sessionId: 's', runId: 'r', stageId: 'plan', stageAttempt: 1, digest: 'd' })).rejects.toThrow(RETIRED);
    expect(nodeChild.execFile).not.toHaveBeenCalled();
  });
});

describe('conversation-agent：主理人对话不再 spawn claude', () => {
  it('invokeAgent 抛 claude_channel_retired，不 spawnSync', async () => {
    const { invokeAgent } = await import('../lib/conversation-agent.js');
    expect(() => invokeAgent({ content: '你好', sessionId: null, journeyId: 'j-1' })).toThrow(RETIRED);
    expect(nodeChild.spawnSync).not.toHaveBeenCalled();
  });
});

describe('orchestrator：Brain 永不选择 claude 作为 attempt provider', () => {
  it('provider registry：auto 选 codex；显式 claude 抛 claude_channel_retired；names 不含 claude', async () => {
    const { createProviderRegistry } = await import('../orchestrator/provider-registry.js');
    const { claudeAdapter } = await import('../orchestrator/providers/claude.js');
    const { codexAdapter } = await import('../orchestrator/providers/codex.js');
    const { grokAdapter } = await import('../orchestrator/providers/grok.js');
    const registry = createProviderRegistry([claudeAdapter, codexAdapter, grokAdapter]);
    expect(registry.resolve({ provider: 'auto', requires: ['structured_output'] }).name).toBe('codex');
    expect(() => registry.resolve({ provider: 'claude', requires: ['structured_output'] })).toThrow(RETIRED);
    expect(() => registry.get('claude')).toThrow(RETIRED);
    expect(registry.names()).not.toContain('claude');
  });

  it('claude adapter：start/resume 拒绝生成 claude 命令', async () => {
    const { claudeAdapter } = await import('../orchestrator/providers/claude.js');
    expect(() => claudeAdapter.start({ bundle: { attempt_id: 'a1', inputs: {} }, execution: {} })).toThrow(RETIRED);
    expect(() => claudeAdapter.resume({
      attempt: { id: 'a1', provider: 'claude', provider_session_id: 's1', task_bundle: { attempt_id: 'a1' } },
      input: 'x', execution: {},
    })).toThrow(RETIRED);
  });

  it('production probe：claude 目标判 provider_adapter_unavailable（preflight 自然换候选）', async () => {
    const { createProviderRegistry } = await import('../orchestrator/provider-registry.js');
    const { claudeAdapter } = await import('../orchestrator/providers/claude.js');
    const { codexAdapter } = await import('../orchestrator/providers/codex.js');
    const registry = createProviderRegistry([claudeAdapter, codexAdapter]);
    expect(() => registry.get('codex')).not.toThrow();
    expect(() => registry.get('claude')).toThrow(RETIRED);
  });
});

describe('派发分配：引导员不再选 claude', () => {
  const snapshot = (claude, codex, grok = 0) => ({ vendors: {
    claude: { available_count: claude }, codex: { available_count: codex }, grok: { available_count: grok },
  } });

  it.each([
    ['abundant', snapshot(2, 5)],
    ['abundant', snapshot(2, 0, 1)],
    ['abundant', snapshot(2, 0, 0)],
    ['tight', snapshot(2, 0, 0)],
  ])('chooseGuidedExecutor(%s) 永不返回 claude', async (budget, snap) => {
    const { chooseGuidedExecutor } = await import('../llm-capacity.js');
    expect(chooseGuidedExecutor('dev', budget, snap).executor).not.toBe('claude');
  });

  it('codex 可用时 dev 任务选 codex 并写 payload.executor', async () => {
    const { applyDispatchAllocationGuide } = await import('../dispatch-allocation-guide.js');
    const out = applyDispatchAllocationGuide({ id: 't', task_type: 'dev', payload: {} }, { budgetState: 'abundant', llmCapacity: snapshot(2, 5) });
    expect(out.payloadPatch.executor).toBe('codex');
  });

  it('无容量快照（legacy）时也不落 claude', async () => {
    const { applyDispatchAllocationGuide } = await import('../dispatch-allocation-guide.js');
    const out = applyDispatchAllocationGuide({ id: 't', task_type: 'dev', payload: {} }, { budgetState: 'abundant', llmCapacity: null });
    expect(out.allocation.selected_executor).not.toBe('claude');
  });
});

describe('worker-pool-dispatch：不再往 tmux 槽发射 claude', () => {
  it('runWorkerPoolDispatch 直接返回 claude_channel_retired，不认领任务、不执行任何命令', async () => {
    const mod = await import('../worker-pool-dispatch.js');
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    const execFn = vi.fn(() => '');
    const out = await mod.runWorkerPoolDispatch(pool, { execFn, ssh: { host: null, opts: '' }, sleep: async () => {} });
    expect(out).toMatchObject({ dispatched: 0, skipped: 'claude_channel_retired' });
    expect(execFn).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('harness-skill-relay：claude 执行体下线（codex/grok 不变）', () => {
  function relayDeps() {
    return {
      env: {},
      pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
      execFn: vi.fn(() => ''),
      spawnFn: vi.fn(async () => {}),
      sshSpawnFn: vi.fn(async () => {}),
      inDockerFn: () => false,
      sshKeyFn: () => null,
      loadSkill: vi.fn(() => 'skill'),
      ensureWt: vi.fn(async () => '/tmp/relay-wt'),
      resolveAccountFn: vi.fn(async (opts) => { opts.env.CECELIA_CREDENTIALS = 'account1'; }),
      authorizeLegacyRelay: async (_input, operation) => operation(),
      tokenFn: vi.fn(async () => 'gh-token'),
    };
  }

  it.each([
    ['无头缺省执行体（即 claude）', {}],
    ['无头显式 executor=claude', { executor: 'claude' }],
    ['有头 executor=claude', { executor: 'claude', mode: 'headed' }],
  ])('%s → claude_channel_retired，不起容器/不 ssh tmux', async (_label, payload) => {
    const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');
    const deps = relayDeps();
    const out = await spawnSkillRelaySession({ id: 'aaaaaaaa-0000-4000-8000-000000000001', task_type: 'harness_initiative', payload }, deps);
    expect(out.ok).toBe(false);
    expect(out.error).toBe('claude_channel_retired');
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(deps.sshSpawnFn).not.toHaveBeenCalled();
    expect(deps.execFn.mock.calls.some(([cmd]) => /tmux|claude/.test(String(cmd)))).toBe(false);
  });
});
