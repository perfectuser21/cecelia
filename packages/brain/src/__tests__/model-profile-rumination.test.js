/**
 * 回归测试：FALLBACK_PROFILE 包含 rumination 的 Anthropic 配置
 * 确保当 DB 不可用时，rumination 不会因缺少默认配置而使用 codex provider
 */

import { describe, it, expect } from 'vitest';
import { FALLBACK_PROFILE } from '../model-profile.js';

describe('FALLBACK_PROFILE — rumination 默认配置', () => {
  it('FALLBACK_PROFILE.config.rumination 使用 anthropic-api + haiku', () => {
    const rumination = FALLBACK_PROFILE.config?.rumination;
    expect(rumination).toBeDefined();
    expect(rumination.provider).toBe('anthropic-api');
    expect(rumination.model).toBe('claude-haiku-4-5-20251001');
  });

  it('FALLBACK_PROFILE.config.rumination 包含 anthropic bridge fallback', () => {
    const fallbacks = FALLBACK_PROFILE.config?.rumination?.fallbacks;
    expect(Array.isArray(fallbacks)).toBe(true);
    expect(fallbacks.length).toBeGreaterThan(0);
    expect(fallbacks[0].provider).toBe('anthropic');
    expect(fallbacks[0].model).toBe('claude-haiku-4-5-20251001');
  });
});
