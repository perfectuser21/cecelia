/**
 * claude-channel — Claude Code 无头调用通道退役的单一来源（任务 76a160b3，决策 067867c8）
 *
 * 主理人曾因 claude -p / 订阅 OAuth 被自动化调用而封号，该通道彻底下线：
 * Brain 及其派生进程不得再以任何方式拉起 claude CLI（-p 无头、tmux 有头、容器内、SSH 到宿主）。
 * anthropic-api（API key 直连）、codex、minimax、openai、grok 不受影响。
 *
 * 这里没有开关：CLAUDE_CHANNEL_RETIRED 只是声明，任何 env / 配置都不能让通道复活。
 * 防复活守卫：src/__tests__/claude-channel-retired.guard.test.js。
 */

import path from 'node:path';

export const CLAUDE_CHANNEL_RETIRED = true;
export const CLAUDE_CHANNEL_RETIRED_CODE = 'claude_channel_retired';

const CLAUDE_COMMAND_NAMES = new Set(['claude', 'claude-launch.sh']);

export class ClaudeChannelRetiredError extends Error {
  constructor(context = '') {
    super(context ? `${CLAUDE_CHANNEL_RETIRED_CODE}: ${context}` : CLAUDE_CHANNEL_RETIRED_CODE);
    this.name = 'ClaudeChannelRetiredError';
    this.code = CLAUDE_CHANNEL_RETIRED_CODE;
  }
}

/** 无条件抛出：放在原本会拉起 claude 的位置。 */
export function assertClaudeChannelRetired(context) {
  throw new ClaudeChannelRetiredError(context);
}

/** 命令名（去引号、取 basename）是否为 claude 或其启动器。 */
export function isClaudeCommand(command) {
  if (typeof command !== 'string') return false;
  const name = path.basename(command.trim().replace(/^['"]|['"]$/g, ''));
  return CLAUDE_COMMAND_NAMES.has(name);
}

/** 执行体 / provider 取值是否指向 claude CLI（容器 entrypoint 缺省执行体即 claude）。 */
export function isClaudeExecutor(executor) {
  return executor === undefined || executor === null || executor === '' || executor === 'claude';
}

export function isClaudeChannelRetiredError(err) {
  return err?.code === CLAUDE_CHANNEL_RETIRED_CODE;
}
