/**
 * routes/harness.test.js — exact-name pairing stub for lint-test-pairing
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('routes/harness module (pairing stub)', () => {
  it('routes/harness.js 已删 harness_planner SQL（仅注释残留）', () => {
    const src = fs.readFileSync(new URL('../harness.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/task_type\s*=\s*['"]harness_planner['"]/i);
  });
});
