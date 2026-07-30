import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { assertionCommand, canonicalRepoIdentity } from '../gp-assertion-command.js';

const ROOT = '/repo';
const PACKAGE = join(ROOT, 'packages/brain');
const TEST_REF = 'packages/brain/src/example.test.js';
const deps = {
  realpathFn: vi.fn(async path => path),
  pathExistsFn: vi.fn(async path => path === join(PACKAGE, 'package.json')),
  isTrackedPathFn: vi.fn(async () => true),
};

describe('trusted GP assertion command policy', () => {
  it.each([
    [`manual:npx vitest run ${TEST_REF}`, process.execPath,
      [join(ROOT, 'node_modules/.bin/vitest'), 'run', './src/example.test.js', '--'],
      PACKAGE, 'vitest',
      [process.execPath, join(ROOT, 'node_modules/.bin/vitest')]],
    ['manual:bash scripts/smoke/gp.sh', '/bin/bash',
      [join(ROOT, 'scripts/smoke/gp.sh')], ROOT, 'bash', ['/bin/bash']],
    ['manual:python3 -m pytest services/tests/test_gp.py', '/usr/bin/python3',
      ['-m', 'pytest', '--', 'services/tests/test_gp.py'], ROOT, 'pytest',
      ['/usr/bin/python3']],
  ])('maps only fixed manual shape %s', async (
    ref,
    executable,
    argv,
    cwd,
    kind,
    toolchainPaths,
  ) => {
    await expect(assertionCommand(ref, ROOT, deps)).resolves.toEqual({
      executable,
      argv,
      options: {
        cwd,
        shell: false,
        evidenceKind: kind,
        toolchain_paths: toolchainPaths,
      },
    });
  });

  it.each(['&&', ';', '|', '`id`', '$(id)', '"quoted"'])('rejects shell %s', async token => {
    await expect(assertionCommand(
      `manual:npx vitest run ${TEST_REF} ${token}`, ROOT, deps,
    )).rejects.toMatchObject({ code: 'UNSAFE_ASSERTION_COMMAND' });
  });

  it.each(['/tmp/evil.test.js', '../evil.test.js'])('rejects escape %s', async ref => {
    await expect(assertionCommand(ref, ROOT, deps)).rejects.toMatchObject({
      code: 'ASSERTION_PATH_ESCAPE',
    });
  });

  it('rejects symlink escape and untracked canonical targets', async () => {
    const escaped = { ...deps, realpathFn: vi.fn(async path => (
      path === ROOT ? ROOT : '/outside/evil.test.js'
    )) };
    await expect(assertionCommand(TEST_REF, ROOT, escaped))
      .rejects.toMatchObject({ code: 'ASSERTION_PATH_ESCAPE' });
    await expect(assertionCommand(TEST_REF, ROOT, {
      ...deps,
      isTrackedPathFn: vi.fn(async () => false),
    })).rejects.toMatchObject({ code: 'ASSERTION_PATH_UNTRACKED' });
  });

  it('uses the tracked canonical pytest target instead of its alias', async () => {
    const canonical = join(ROOT, 'services/tests/test_real.py');
    const command = await assertionCommand(
      'services/tests/test_alias.py',
      ROOT,
      { ...deps, realpathFn: vi.fn(async path => path === ROOT ? ROOT : canonical) },
    );
    expect(command.argv).toEqual([
      '-m',
      'pytest',
      '--',
      'services/tests/test_real.py',
    ]);
  });

  it.each([
    ['https://token@github.com/OpenAI/cecelia.git', 'github.com/OpenAI/cecelia'],
    ['git@GitHub.com:OpenAI/cecelia.git', 'github.com/OpenAI/cecelia'],
  ])('canonicalizes origin without credentials', (origin, expected) => {
    expect(canonicalRepoIdentity(origin)).toBe(expected);
  });

});
