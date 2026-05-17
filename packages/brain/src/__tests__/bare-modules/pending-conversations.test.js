/**
 * Bare Module Test: pending-conversations.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect } from 'vitest';

describe('pending-conversations module', () => {
  it('can be imported', async () => {
    const mod = await import('../../pending-conversations.js');
    expect(mod).toBeDefined();
  });

  it('exports recordOutbound function', async () => {
    const { recordOutbound } = await import('../../pending-conversations.js');
    expect(typeof recordOutbound).toBe('function');
  });

  it('exports resolveByPersonReply function', async () => {
    const { resolveByPersonReply } = await import('../../pending-conversations.js');
    expect(typeof resolveByPersonReply).toBe('function');
  });

  it('exports shouldFollowUp function', async () => {
    const { shouldFollowUp } = await import('../../pending-conversations.js');
    expect(typeof shouldFollowUp).toBe('function');
  });
});
