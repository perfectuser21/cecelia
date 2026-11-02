import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('retired self-issued Quality certificate', () => {
  it('cannot issue a PASSED certificate through the old qa:gate command', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cecelia-quality-certificate-'));
    try {
      const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));
      writeFileSync(join(directory, 'package.json'), JSON.stringify({
        name: 'owned-quality-retirement-fixture', version: '1.0.0', scripts: manifest.scripts,
      }));
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
      const result = spawnSync('npm', ['--cache', join(directory, '.npm-cache'), 'run', 'qa:gate', '--silent'], {
        cwd: directory, env, encoding: 'utf8', timeout: 10000,
      });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).not.toBe(0);
      expect(existsSync(join(directory, '.quality-gate-passed'))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
