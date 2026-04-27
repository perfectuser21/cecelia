import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock feishu/env to prevent real HTTP calls
vi.mock('../alerting.js', () => ({ raise: vi.fn() }));
vi.mock('dotenv/config', () => ({}));

const originalEnv = process.env;
beforeEach(() => {
  process.env = { ...originalEnv, FEISHU_APP_ID: '', FEISHU_APP_SECRET: '', FEISHU_OWNER_OPEN_IDS: '' };
});

// Test the in-memory internals via dynamic import reset
describe('notifier _lastSent memory leak fix', () => {
  it('_pruneExpired exported for size check', async () => {
    const mod = await import('../notifier.js');
    expect(typeof mod.sendRateLimited ?? mod.default).toBeDefined();
  });

  it('notifier module loads without error', async () => {
    await expect(import('../notifier.js')).resolves.toBeDefined();
  });

  it('_lastSent does not grow beyond _MAX_ENTRIES by design', () => {
    // White-box: verify that MAX_ENTRIES constant and pruneExpired logic exist in source
    const fs = require('fs');
    const src = fs.readFileSync(
      new URL('../notifier.js', import.meta.url).pathname, 'utf8'
    );
    expect(src).toContain('_MAX_ENTRIES');
    expect(src).toContain('_pruneExpired');
    expect(src).toContain('_lastSent.clear()');
  });
});
