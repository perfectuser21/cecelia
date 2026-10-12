import { describe, it, expect, vi } from 'vitest';
vi.mock('../lib/ssh-exec.js', () => ({ sshWithStdin: vi.fn() }));
vi.mock('../machine-registry.js', () => ({ resolvePrimaryWorkerId: () => 'mmv', sshTargetFor: () => 'mmv' }));
import { sshWithStdin } from '../lib/ssh-exec.js';
import { callConversationSummary } from '../conversation-summary-openclaw.js';
import { summarizeSession } from '../conversation-capture.js';
import { summaryAgentConfig } from '../../scripts/configure-conversation-summarizer.mjs';

describe('会话摘要 OpenClaw Codex 通道', () => {
  it('部署合同固定 Codex、空技能与全部工具拒绝，不沿用有行动权限的 agent', () => {
    expect(summaryAgentConfig('/home/runner')).toMatchObject({
      model: { primary: 'openai/gpt-6.1-sol', fallbacks: [] },
      skills: [], tools: { profile: 'minimal', deny: ['*'], elevated: { enabled: false } },
      workspace: '/home/runner/openclaw-root/workspaces-root/clawd-conversation-summarizer',
    });
  });
  it('默认摘要通过远端无工具专用 agent，正文只经 stdin，独立 session', async () => {
    sshWithStdin.mockResolvedValue(JSON.stringify({ result: { payloads: [{ text: '{"topics":["恢复工作流部署","核验私密发布"]}' }] } }));
    expect(await summarizeSession('用户原文 `不可执行` $(不可执行)')).toBe('1. 恢复工作流部署\n2. 核验私密发布');
    const [, args, input, timeout] = sshWithStdin.mock.lastCall;
    expect(args.at(-1)).toContain('--agent conversation-summarizer');
    expect(args.at(-1)).toMatch(/--session-id summary-[a-f0-9-]+/);
    expect(args.at(-1)).not.toContain('用户原文');
    expect(input).toContain('用户原文 `不可执行` $(不可执行)');
    expect(timeout).toBeGreaterThan(90000);
  });
  it('兼容带启动日志的多行 CLI 包装，仅消费最终可见正文', async () => {
    sshWithStdin.mockResolvedValue('启动日志\n' + JSON.stringify({ finalAssistantVisibleText: '{"topics":["真实结论"]}' }, null, 2));
    expect((await callConversationSummary('thalamus', '摘要')).text).toBe('{"topics":["真实结论"]}');
  });
  it('空回执、坏 JSON、传输失败均报错，摘要层仍安全降级', async () => {
    for (const stdout of ['非JSON', '{"result":{"payloads":[]}}']) {
      sshWithStdin.mockResolvedValue(stdout);
      await expect(callConversationSummary('thalamus', '摘要')).rejects.toThrow('summary_reply_missing');
    }
    sshWithStdin.mockRejectedValue(new Error('transport_failed'));
    expect(await summarizeSession('原文')).toBeNull();
  });
  it('每次摘要使用新 session，禁止重用历史对话', async () => {
    sshWithStdin.mockResolvedValue('{"finalAssistantVisibleText":"{}"}');
    await callConversationSummary('thalamus', '一');
    const a = sshWithStdin.mock.lastCall[1].at(-1);
    await callConversationSummary('thalamus', '二');
    expect(sshWithStdin.mock.lastCall[1].at(-1)).not.toBe(a);
  });
});
