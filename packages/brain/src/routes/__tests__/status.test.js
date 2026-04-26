/**
 * routes/status.test.js — exact-name pairing stub for lint-test-pairing
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('routes/status module (pairing stub)', () => {
  it('routes/status.js 已删 harness_planner SQL', () => {
    const src = fs.readFileSync(new URL('../status.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/task_type\s*=\s*['"]harness_planner['"]/i);
  });
});
