// 测试实例隔离闸（runtime-safety，非本 PR 被改模块）放行；真实隔离入口由 runtime-isolation.test.js 验证。
vi.mock('../../../packages/brain/src/runtime-safety.js', () => ({ assertExternalExecutionAllowed: () => {} }));
// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：执行体选择（provider 选择 / 派发 / 监工唤醒）
//
// Claude Code 无头通道退役（任务 76a160b3，决策 067867c8）：主理人曾因 claude -p / 订阅 OAuth
// 被自动化调用而封号。造的这一步不得再以任何方式拉起 claude CLI——
//   provider-registry：auto 永不选 claude，显式 claude 抛 claude_channel_retired
//   providers/claude：start/resume 不再生成任何命令
//   spawn：CECELIA_EXECUTOR 缺省/claude 的容器在最底层拒绝，不碰 docker
//
// 真 import 被改模块（lint-gp-anchor-artifact 要求），不 mock 它们；只注入外部 IO 桩。
import { describe, it, expect, vi } from 'vitest';
import { createProviderRegistry } from '../../../packages/brain/src/orchestrator/provider-registry.js';
import { claudeAdapter } from '../../../packages/brain/src/orchestrator/providers/claude.js';
import { codexAdapter } from '../../../packages/brain/src/orchestrator/providers/codex.js';
import { grokAdapter } from '../../../packages/brain/src/orchestrator/providers/grok.js';
import { spawn } from '../../../packages/brain/src/spawn/spawn.js';

const RETIRED = expect.objectContaining({ code: 'claude_channel_retired' });
const TASK_ID = '88888888-8888-4888-8888-888888888888';

describe('GP F1 step3 — Claude 无头通道已退役：执行体选择不再落到 claude', () => {
  it('provider-registry（生产同款 adapter 清单）：claude 不注册，auto 选 codex', () => {
    const registry = createProviderRegistry([claudeAdapter, codexAdapter, grokAdapter]);
    expect(registry.names()).not.toContain('claude');
    expect(registry.resolve({ provider: 'auto' })).toBe(codexAdapter);
    expect(registry.resolve({}).name).toBe('codex');
  });

  it('provider-registry：显式 claude 抛 claude_channel_retired（get / resolve 两个入口）', () => {
    const registry = createProviderRegistry([claudeAdapter, codexAdapter, grokAdapter]);
    expect(() => registry.get('claude')).toThrow(RETIRED);
    expect(() => registry.resolve({ provider: 'claude' })).toThrow(RETIRED);
  });

  it('providers/claude：start / resume 不再生成 claude 命令，直接抛 claude_channel_retired', () => {
    expect(() => claudeAdapter.start({ bundle: { attempt_id: 'a1' }, execution: { command: 'claude' } })).toThrow(RETIRED);
    expect(() => claudeAdapter.resume({ attempt: { id: 'a1', provider: 'claude' } })).toThrow(RETIRED);
  });

  it('spawn：CECELIA_EXECUTOR 缺省或 claude → 最底层拒绝（不进 middleware、不碰 docker）', async () => {
    await expect(spawn({ task: { id: TASK_ID }, env: { CECELIA_EXECUTOR: 'claude' } })).rejects.toThrow(RETIRED);
    await expect(spawn({ task: { id: TASK_ID }, env: {} })).rejects.toThrow(RETIRED);
  });
});
