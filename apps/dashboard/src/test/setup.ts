import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { configure } from '@testing-library/react';

// Configure @testing-library/react to advance fake timers when using waitFor.
// This ensures waitFor retries work correctly when vi.useFakeTimers() is active.
configure({
  asyncWrapper: async (cb) => {
    let result: any;
    await vi.runAllTimersAsync().catch(() => {});
    result = await cb();
    return result;
  },
});

// Mock fetch globally
global.fetch = vi.fn();

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  error: vi.fn(),
  warn: vi.fn(),
};
