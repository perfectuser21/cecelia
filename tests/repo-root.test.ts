import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers/repo-root.js';

describe('REPO_ROOT', () => {
  it('resolves the repository independently of process.cwd()', () => {
    expect(existsSync(join(REPO_ROOT, 'packages/brain/package.json'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'scripts/extract-contract-e2e.cjs'))).toBe(true);
  });
});
