import { isAbsolute, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { assertionCommand } from '../gp-assertion-command.js';

const ROOT = '/repo';
const PACKAGE = join(ROOT, 'packages/brain');
const VITEST_LINK = join(ROOT, 'node_modules/.bin/vitest');
const VITEST_REAL = join(ROOT, 'node_modules/vitest/vitest.mjs');
const NODE_LINK = '/opt/toolchains/node';
const NODE_REAL = '/opt/toolchains/node-v24';
const PYTHON_REAL = '/opt/toolchains/python3.12';
const deps = {
  realpathFn: vi.fn(async path => {
    if (path === VITEST_LINK) return VITEST_REAL;
    if (path === NODE_LINK) return NODE_REAL;
    if (path === '/usr/bin/python3') return PYTHON_REAL;
    return path;
  }),
  pathExistsFn: vi.fn(async path => path === join(PACKAGE, 'package.json')),
  isTrackedPathFn: vi.fn(async () => true),
  nodeExecutable: NODE_LINK,
};

describe('GP assertion command invocation hardening', () => {
  it('uses Vitest 1.6 positional syntax for an option-shaped target', async () => {
    const command = await assertionCommand(
      'packages/brain/--config=src/evil.test.js',
      ROOT,
      deps,
    );

    expect(command).toEqual({
      executable: NODE_REAL,
      argv: [VITEST_REAL, 'run', './--config=src/evil.test.js', '--'],
      options: {
        cwd: PACKAGE,
        shell: false,
        evidenceKind: 'vitest',
        toolchain_paths: [NODE_REAL, VITEST_REAL],
      },
    });
  });

  it('uses absolute pinned Python and bash toolchain manifests', async () => {
    const pytest = await assertionCommand(
      'services/tests/test_gp.py',
      ROOT,
      deps,
    );
    const bash = await assertionCommand(
      'scripts/smoke/gp.sh',
      ROOT,
      deps,
    );

    expect(pytest).toEqual({
      executable: PYTHON_REAL,
      argv: ['-m', 'pytest', '--', 'services/tests/test_gp.py'],
      options: {
        cwd: ROOT,
        shell: false,
        evidenceKind: 'pytest',
        toolchain_paths: [PYTHON_REAL],
      },
    });
    expect(bash.options.toolchain_paths).toEqual(['/bin/bash']);
    expect([pytest, bash].every(command => (
      isAbsolute(command.executable)
      && command.options.toolchain_paths.every(isAbsolute)
    ))).toBe(true);
  });
});
