/**
 * Tick Periodic Cleanup Tests
 * 保留共享cleanup计时器reset入口的兼容合同。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _resetLastCleanupTime } from '../tick.js';

describe('tick periodic cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetLastCleanupTime();
  });

  it('_resetLastCleanupTime is exported and callable', () => {
    expect(typeof _resetLastCleanupTime).toBe('function');
    _resetLastCleanupTime(); // should not throw
  });
});
