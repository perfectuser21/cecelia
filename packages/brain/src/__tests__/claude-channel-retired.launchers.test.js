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

const RETIRED = /claude_channel_retired/;
beforeEach(() => vi.clearAllMocks());

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
