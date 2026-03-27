/**
 * content-pipeline test-step provider 解析逻辑单元测试
 * 覆盖：provider 优先级（reqProvider > gpt模型→openai > 默认anthropic）
 */
import { describe, it, expect } from 'vitest';

/**
 * 从 content-pipeline.js 提取的 provider 解析逻辑（纯函数）
 * 用于单元测试，与路由实现保持一致
 */
function resolveProvider(reqProvider, resolvedModel) {
  if (reqProvider) return reqProvider;
  if (resolvedModel.startsWith('gpt')) return 'openai';
  return 'anthropic';
}

describe('test-step provider 解析', () => {
  it('不传 provider 时默认使用 anthropic（无头 bridge）', () => {
    expect(resolveProvider(undefined, 'claude-sonnet-4-20250514')).toBe('anthropic');
  });

  it('不传 provider 时默认使用 anthropic（其他 claude 模型）', () => {
    expect(resolveProvider(undefined, 'claude-opus-4-20250514')).toBe('anthropic');
  });

  it('GPT 模型不传 provider 时自动使用 openai', () => {
    expect(resolveProvider(undefined, 'gpt-4o')).toBe('openai');
    expect(resolveProvider(undefined, 'gpt-3.5-turbo')).toBe('openai');
  });

  it('reqProvider 优先级最高（覆盖默认逻辑）', () => {
    expect(resolveProvider('anthropic-api', 'claude-sonnet-4-20250514')).toBe('anthropic-api');
    expect(resolveProvider('anthropic', 'gpt-4o')).toBe('anthropic');
    expect(resolveProvider('openai', 'claude-opus-4-20250514')).toBe('openai');
  });

  it('空字符串 reqProvider 不触发优先级（走默认）', () => {
    expect(resolveProvider('', 'claude-sonnet-4-20250514')).toBe('anthropic');
    expect(resolveProvider('', 'gpt-4o')).toBe('openai');
  });
});
