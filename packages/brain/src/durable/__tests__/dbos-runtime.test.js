import { describe, it, expect } from 'vitest';
import { isDurableEnabled } from '../dbos-runtime.js';

describe('dbos-runtime 门控', () => {
  it('默认（无 env）返回 false', () => {
    delete process.env.DBOS_DURABLE_ENABLED;
    expect(isDurableEnabled()).toBe(false);
  });
  it('DBOS_DURABLE_ENABLED=true 才 true', () => {
    process.env.DBOS_DURABLE_ENABLED = 'true';
    expect(isDurableEnabled()).toBe(true);
    process.env.DBOS_DURABLE_ENABLED = 'false';
    expect(isDurableEnabled()).toBe(false);
    delete process.env.DBOS_DURABLE_ENABLED;
  });
});
