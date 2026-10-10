/**
 * claude-channel 单测 — Claude Code 无头通道退役的单一来源（任务 76a160b3，决策 067867c8）。
 * 跨入口的防复活守卫见 src/__tests__/claude-channel-retired.guard.test.js。
 */
import { describe, it, expect } from 'vitest';
import {
  CLAUDE_CHANNEL_RETIRED,
  CLAUDE_CHANNEL_RETIRED_CODE,
  ClaudeChannelRetiredError,
  assertClaudeChannelRetired,
  isClaudeCommand,
  isClaudeExecutor,
  isClaudeChannelRetiredError,
} from '../claude-channel.js';

describe('claude-channel', () => {
  it('通道退役是常量声明，错误码固定为 claude_channel_retired', () => {
    expect(CLAUDE_CHANNEL_RETIRED).toBe(true);
    expect(CLAUDE_CHANNEL_RETIRED_CODE).toBe('claude_channel_retired');
  });

  it('isClaudeCommand：claude 与其启动器（含绝对路径/引号）判为 claude', () => {
    expect(isClaudeCommand('claude')).toBe(true);
    expect(isClaudeCommand('/opt/homebrew/bin/claude')).toBe(true);
    expect(isClaudeCommand('  "/usr/local/bin/claude"  ')).toBe(true);
    expect(isClaudeCommand('/Users/administrator/perfect21/cecelia/scripts/claude-launch.sh')).toBe(true);
  });

  it('isClaudeCommand：非 claude 命令与非字符串一律 false', () => {
    expect(isClaudeCommand('codex')).toBe(false);
    expect(isClaudeCommand('/opt/homebrew/bin/codex')).toBe(false);
    expect(isClaudeCommand('grok-launch.sh')).toBe(false);
    expect(isClaudeCommand('claude-code-helper')).toBe(false);
    expect(isClaudeCommand('/opt/claude/bin/node')).toBe(false);
    expect(isClaudeCommand(undefined)).toBe(false);
    expect(isClaudeCommand(null)).toBe(false);
  });

  it('isClaudeExecutor：缺省执行体与显式 claude 判为 claude，其余执行体不是', () => {
    for (const v of [undefined, null, '', 'claude']) expect(isClaudeExecutor(v)).toBe(true);
    for (const v of ['codex', 'grok', 'minimax', 'anthropic-api']) expect(isClaudeExecutor(v)).toBe(false);
  });

  it('ClaudeChannelRetiredError：带统一错误码，message 以错误码开头并附上下文', () => {
    const err = new ClaudeChannelRetiredError('spawn');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ClaudeChannelRetiredError');
    expect(err.code).toBe('claude_channel_retired');
    expect(err.message).toBe('claude_channel_retired: spawn');
    expect(new ClaudeChannelRetiredError().message).toBe('claude_channel_retired');
  });

  it('assertClaudeChannelRetired 无条件抛出，isClaudeChannelRetiredError 只认错误码', () => {
    let caught;
    try { assertClaudeChannelRetired('llm-caller'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ClaudeChannelRetiredError);
    expect(caught.message).toBe('claude_channel_retired: llm-caller');
    expect(isClaudeChannelRetiredError(caught)).toBe(true);
    expect(isClaudeChannelRetiredError({ code: 'claude_channel_retired' })).toBe(true);
    expect(isClaudeChannelRetiredError(new Error('claude_channel_retired'))).toBe(false);
    expect(isClaudeChannelRetiredError(null)).toBe(false);
  });
});
