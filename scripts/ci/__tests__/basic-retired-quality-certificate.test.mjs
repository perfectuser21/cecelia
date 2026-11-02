import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('retired self-issued Quality certificate', () => {
  it('cannot issue a PASSED certificate through the old qa:gate command', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cecelia-quality-certificate-'));
    try {
      const oldManifest=fileURLToPath(new URL('../../../packages/quality/package.json',import.meta.url));
      const manifest=existsSync(oldManifest)?JSON.parse(readFileSync(oldManifest,'utf8')):{scripts:{}};
      writeFileSync(join(directory, 'package.json'), JSON.stringify({
        name: 'owned-quality-retirement-fixture', version: '1.0.0', scripts: manifest.scripts,
      }));
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
      const result = spawnSync('npm', ['--cache', join(directory, '.npm-cache'), 'run', 'qa:gate', '--silent'], {
        cwd: directory, env, encoding: 'utf8', timeout: 10000,
      });
      assert.equal(result.error,undefined);
      assert.equal(result.signal,null);
      assert.notEqual(result.status,0);
      assert.equal(existsSync(join(directory, '.quality-gate-passed')),false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
