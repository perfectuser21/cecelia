import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadLangfuseConfig,
  _resetLangfuseConfig,
  _setLangfuseConfigForTesting,
} from '../langfuse-config.js';

describe('langfuse-config', () => {
  beforeEach(() => {
    _resetLangfuseConfig();
  });

  it('returns null when no credentials file exists', () => {
    const cfg = loadLangfuseConfig();
    expect(cfg).toBe(null);
  });

  it('returns cached config on second call', () => {
    const mockCfg = {
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
      LANGFUSE_BASE_URL: 'https://langfuse.example.com',
    };
    _setLangfuseConfigForTesting(mockCfg);
    expect(loadLangfuseConfig()).toBe(mockCfg);
    expect(loadLangfuseConfig()).toBe(mockCfg);
  });

  it('_resetLangfuseConfig clears state', () => {
    _setLangfuseConfigForTesting({ LANGFUSE_PUBLIC_KEY: 'x', LANGFUSE_SECRET_KEY: 'y', LANGFUSE_BASE_URL: 'z' });
    _resetLangfuseConfig();
    const cfg = loadLangfuseConfig();
    expect(cfg).toBe(null);
  });
});
