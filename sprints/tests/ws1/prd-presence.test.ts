import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VALIDATOR_PATH = '../../validators/prd-presence.mjs';
const TMP_DIR = join(tmpdir(), 'ws1-prd-presence-' + Date.now());

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(join(TMP_DIR, 'empty.md'), '');
});

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('Workstream 1 — checkSprintPrdPresence [BEHAVIOR]', () => {
  it('returns ok=true with size and lines for the real sprint PRD', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const result = mod.checkSprintPrdPresence('sprints/sprint-prd.md');
    expect(result.ok).toBe(true);
    expect(typeof result.size).toBe('number');
    expect(result.size).toBeGreaterThan(0);
    expect(typeof result.lines).toBe('number');
    expect(result.lines).toBeGreaterThanOrEqual(50);
  });

  it('returns ok=false with reason=missing when path does not exist, instead of throwing', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const result = mod.checkSprintPrdPresence('sprints/__definitely_does_not_exist__.md');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing');
  });

  it('returns ok=false with reason=empty when the file exists but is zero bytes', async () => {
    const mod: any = await import(VALIDATOR_PATH);
    const result = mod.checkSprintPrdPresence(join(TMP_DIR, 'empty.md'));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty');
  });
});
