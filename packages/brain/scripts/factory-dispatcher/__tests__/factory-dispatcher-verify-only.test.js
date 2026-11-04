import { describe, it, expect } from 'vitest';
import { readDispatchMode, buildAgentMessage } from '../factory-dispatcher.js';

// 旧入口的迁移拒绝/零副作用由factory-retirement.test.js直接守住。
// 这里仅声明真实配置与消息合同，不把迁移早退计为资格或快照校验。
describe('历史核验配置与消息合同', () => {
  it('读取显式模式，错误配置拒绝', () => {
    expect(readDispatchMode()).toBe('all');
    expect(readDispatchMode('verify-only')).toBe('verify-only');
    for (const mode of ['verify', '', 'true', null]) expect(() => readDispatchMode(mode)).toThrow('dispatch mode');
  });
  it('核验消息要求独立读证据且禁止对外动作', () => {
    const text = buildAgentMessage({ runId: 'sfv-test', taskId: 'fixture-task', contract: {
      stage: 'verify', skill: 'run-verify', agent: 'skill-factory',
      device: { profile: 'fixture', serial: 'fixture' },
    } });
    expect(text).toContain('禁止读取执行会话');
    expect(text).toContain('禁止对外动作');
  });
});
