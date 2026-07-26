import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const GUARD = path.join(REPO_ROOT, 'scripts', 'ratchet-guard.mjs');

let root: string;
let contractPath: string;

function runGuard() {
  return spawnSync(
    process.execPath,
    [GUARD, '--root', root, '--json'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true' },
    },
  );
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ratchet-transitional-'));
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  mkdirSync(path.join(root, 'sprints/demo/tests'), { recursive: true });

  writeFileSync(
    path.join(root, 'scripts', 'ratchet-registry.json'),
    JSON.stringify([
      {
        name: 'orphans',
        label: 'sprints orphan tests',
        direction: 'only_down',
        watermark: 0,
      },
    ]),
  );
  writeFileSync(
    path.join(root, 'scripts', 'test-pyramid-baseline.json'),
    JSON.stringify({
      orphans: 0,
      permanent: 0,
      permanent_roots: [],
      smoke_dir: 'scripts/smoke',
      bare_fr: 0,
    }),
  );
  writeFileSync(
    path.join(root, 'sprints/demo/tests/registered.test.ts'),
    'it("is registered", () => {});\n',
  );

  contractPath = path.join(root, 'sprints/demo/contract-draft.md');
  writeFileSync(
    contractPath,
    [
      '# Contract',
      '',
      '## Test Contract',
      '',
      '| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |',
      '|---|---|---|---|',
      '| WS1 | `tests/registered.test.ts` | B-01 | expected red |',
      '',
    ].join('\n'),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ratchet transitional orphan measurement', () => {
  it('passes a same-sprint contract-registered artifact', () => {
    const result = runGuard();

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('"value": 0');
    expect(result.stdout).toContain('raw=1 registered=1 unregistered=0');
  });

  it('fails orphans after the registering contract is removed', () => {
    unlinkSync(contractPath);

    const result = runGuard();

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('orphans');
    expect(result.stdout).toContain('"value": 1');
    expect(result.stdout).toContain('raw=1 registered=0 unregistered=1');
  });
});
