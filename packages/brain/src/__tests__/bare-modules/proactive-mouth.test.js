/**
 * Bare Module Test: proactive-mouth.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect } from 'vitest';

describe('proactive-mouth module', () => {
  it('can be imported', async () => {
    const mod = await import('../../proactive-mouth.js');
    expect(mod).toBeDefined();
  });

  it('exports sendProactiveMessage function', async () => {
    const { sendProactiveMessage } = await import('../../proactive-mouth.js');
    expect(typeof sendProactiveMessage).toBe('function');
  });

  it('exports notifyTaskCompletion function', async () => {
    const { notifyTaskCompletion } = await import('../../proactive-mouth.js');
    expect(typeof notifyTaskCompletion).toBe('function');
  });

  it('exports expressDesire function', async () => {
    const { expressDesire } = await import('../../proactive-mouth.js');
    expect(typeof expressDesire).toBe('function');
  });
});
