import { describe, it, expect } from 'vitest';
import { parseExecParams, requestedAiAccount } from '../routing/exec-params.js';

describe('秋米显式 AI 账号失败关闭合同', () => {
  const body = (account) => `【执行设置——启动前落实】\nAI账号：${account}\n【执行参数】\n执行Agent：dev\n模型：openai/gpt-6.1-sol\n【执行要求】\n只读检查`;

  it.each(['openai-plus3', 'openai:xuxiao21xx@icloud.com'])('识别 %s 并阻断未经证明的账号绑定', (account) => {
    expect(requestedAiAccount(body(account))).toEqual([account]);
    const result = parseExecParams(body(account), { modelAllowlist: ['openai/gpt-6.1-sol'] });
    expect(result.errors).toContain('openclaw_profile_binding_unavailable');
  });

  it('空账号、冲突账号和 shell 字符不会被静默忽略', () => {
    for (const value of ['', 'openai-plus3\nAI账号：other', 'openai-plus3;id']) {
      expect(parseExecParams(body(value)).errors).toContain('bad_ai_account');
    }
  });
});
