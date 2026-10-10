import {
  normalizeProviderResult,
  parseJsonValue,
} from './shared.js';
import { ClaudeChannelRetiredError } from '../../lib/claude-channel.js';

/**
 * Claude Code 无头通道已退役（任务 76a160b3，决策 067867c8）：start/resume 不再生成任何 claude 命令。
 * 只保留 inspect/cancel/normalizeResult，用于收尾退役前已经跑完的历史 attempt。
 * provider-registry 也不会注册本 adapter，Brain 永不选择 claude 作为 attempt provider。
 */
export const claudeAdapter = Object.freeze({
  name: 'claude',
  capabilities: Object.freeze(['structured_output', 'resume', 'skills_inline']),

  start({ bundle }) {
    throw new ClaudeChannelRetiredError(`provider claude start attempt=${bundle?.attempt_id ?? 'unknown'}`);
  },

  resume({ attempt }) {
    throw new ClaudeChannelRetiredError(`provider claude resume attempt=${attempt?.id ?? 'unknown'}`);
  },

  inspect({ attempt }) {
    return { supported: false, provider: 'claude', attempt_id: attempt?.id };
  },

  cancel({ attempt }) {
    return { supported: false, provider: 'claude', attempt_id: attempt?.id };
  },

  normalizeResult({ attempt, raw }) {
    const wrapper = parseJsonValue(raw?.stdout, 'Claude stdout');
    const payload = parseJsonValue(wrapper.structured_output ?? wrapper.result, 'Claude result');
    return normalizeProviderResult({
      attempt,
      payload,
      provider: 'claude',
      sessionId: wrapper.session_id,
    });
  },
});
