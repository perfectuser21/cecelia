import { describe, expect, it, vi } from 'vitest';

import { createProviderRegistry } from '../provider-registry.js';

function adapter(name, capabilities = []) {
  return {
    name,
    capabilities,
    start: vi.fn(),
    resume: vi.fn(),
    inspect: vi.fn(),
    cancel: vi.fn(),
    normalizeResult: vi.fn(),
  };
}

describe('createProviderRegistry', () => {
  it('auto 按能力选择已注册 provider，而不挑选模型', () => {
    const claude = adapter('claude', ['structured_output', 'resume']);
    const codex = adapter('codex', ['structured_output', 'resume', 'json_events']);
    const registry = createProviderRegistry([claude, codex]);

    expect(registry.resolve({ provider: 'auto', requires: ['json_events'] })).toBe(codex);
    expect(registry.resolve({ requires: ['structured_output'] })).toBe(claude);
  });

  it('显式 provider 缺能力时 fail-fast', () => {
    const registry = createProviderRegistry([adapter('claude', ['resume'])]);

    expect(() => registry.resolve({
      provider: 'claude',
      requires: ['structured_output'],
    })).toThrow(/missing capabilities.*structured_output/i);
  });

  it('拒绝同名 provider 和不完整 adapter', () => {
    expect(() => createProviderRegistry([adapter('codex'), adapter('codex')])).toThrow(/duplicate/i);
    expect(() => createProviderRegistry([{ name: 'broken', capabilities: [] }])).toThrow(/start/i);
  });

  it('找不到匹配 provider 时给出明确错误', () => {
    const registry = createProviderRegistry([adapter('claude', ['resume'])]);

    expect(() => registry.resolve({ provider: 'auto', requires: ['json_events'] }))
      .toThrow(/no provider.*json_events/i);
    expect(() => registry.get('grok')).toThrow(/unknown provider.*grok/i);
  });
});
