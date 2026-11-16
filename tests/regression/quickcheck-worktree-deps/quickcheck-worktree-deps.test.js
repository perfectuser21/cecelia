import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const helper = new URL('../../../scripts/lib/worktree-node-modules.sh', import.meta.url).pathname;
const tempDirs = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('QuickCheck worktree dependency linking', () => {
  it('links missing package dependencies without deleting a local Vite cache', () => {
    const root = mkdtempSync(join(tmpdir(), 'quickcheck-worktree-'));
    tempDirs.push(root);
    const source = join(root, 'main-node-modules');
    const target = join(root, 'worktree-node-modules');
    mkdirSync(join(source, 'react'), { recursive: true });
    mkdirSync(join(target, '.vite'), { recursive: true });
    writeFileSync(join(source, 'react', 'jsx-dev-runtime.js'), 'export {};');
    writeFileSync(join(target, '.vite', 'cache'), 'keep');

    const result = spawnSync('bash', ['-c', 'source "$1"; link_missing_node_modules "$2" "$3"', '_', helper, source, target], {
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(statSync(join(target, 'react', 'jsx-dev-runtime.js')).size).toBeGreaterThan(0);
    expect(statSync(join(target, '.vite', 'cache')).size).toBeGreaterThan(0);
  });

});
