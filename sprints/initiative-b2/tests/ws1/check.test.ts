import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SPRINT_DIR = join(HERE, '..', '..');
const REPO_ROOT = join(SPRINT_DIR, '..', '..');
const CHECK_SCRIPT = join(SPRINT_DIR, 'check.mjs');
const MANIFEST = join(SPRINT_DIR, 'manifest.json');
const MANIFEST_BACKUP = join(SPRINT_DIR, 'manifest.json.bak-test');

function runCheck() {
  return spawnSync(process.execPath, [CHECK_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

describe('Workstream 1 — check.mjs [BEHAVIOR]', () => {
  afterEach(() => {
    if (existsSync(MANIFEST_BACKUP)) {
      renameSync(MANIFEST_BACKUP, MANIFEST);
    }
  });

  it('exits with code 0 in a clean checkout', () => {
    expect(existsSync(CHECK_SCRIPT)).toBe(true);
    const result = runCheck();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });

  it('exits with non-zero code and reports manifest error when manifest.json is missing', () => {
    expect(existsSync(MANIFEST)).toBe(true);
    copyFileSync(MANIFEST, MANIFEST_BACKUP);
    renameSync(MANIFEST, MANIFEST + '.tmp-removed');
    try {
      const result = runCheck();
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect((result.status ?? -1)).toBeGreaterThan(0);
      const combined = `${result.stderr ?? ''}${result.stdout ?? ''}`;
      expect(combined.toLowerCase()).toContain('manifest');
    } finally {
      if (existsSync(MANIFEST + '.tmp-removed')) {
        renameSync(MANIFEST + '.tmp-removed', MANIFEST);
      }
    }
  });
});
