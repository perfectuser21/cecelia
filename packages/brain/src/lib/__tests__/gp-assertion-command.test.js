import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { assertionCommand, canonicalRepoIdentity } from '../gp-assertion-command.js';

const ROOT = '/repo';
const PACKAGE = join(ROOT, 'packages/brain');
const SHA = `sha256:${'a'.repeat(64)}`;
const TOOLS = {
  node: { path: '/tools/node-link', sha256: SHA },
  vitest: { path: join(ROOT, 'node_modules/.bin/vitest'), sha256: SHA },
  python: { path: '/tools/python3', sha256: SHA },
  bash: { path: '/bin/bash', sha256: SHA },
};
const REAL = {
  '/tools/node-link': '/tools/node-real',
  [join(ROOT, 'node_modules/.bin/vitest')]:
    join(ROOT, 'node_modules/vitest/vitest.mjs'),
};
const deps = {
  toolchains: TOOLS,
  realpathFn: vi.fn(async path => REAL[path] ?? path),
  pathExistsFn: vi.fn(async path => path === join(PACKAGE, 'package.json')),
  isTrackedPathFn: vi.fn(async () => true),
};

describe('trusted GP assertion command policy', () => {
  it.each([
    ['packages/brain/src/example.test.js', '/tools/node-real',
      [join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', './src/example.test.js', '--'],
      PACKAGE, 'vitest', ['node', 'vitest']],
    ['scripts/smoke/gp.sh', '/bin/bash',
      [join(ROOT, 'scripts/smoke/gp.sh')], ROOT, 'bash', ['bash']],
    ['services/tests/test_gp.py', '/tools/python3',
      ['-m', 'pytest', '--', 'services/tests/test_gp.py'],
      ROOT, 'pytest', ['python']],
  ])('builds a pinned positional %s command', async (
    ref, executable, argv, cwd, kind, toolNames,
  ) => {
    const command = await assertionCommand(ref, ROOT, deps);
    expect(command).toMatchObject({
      executable, argv,
      options: {
        cwd, shell: false, evidenceKind: kind,
        env: { inherit: false, allowlist: [] },
      },
    });
    expect(command.options.toolchain.map(({ name, path }) => ({ name, path })))
      .toEqual(toolNames.map(name => ({
        name,
        path: REAL[TOOLS[name].path] ?? TOOLS[name].path,
      })));
  });

  it.each([
    'packages/brain/--config=src/evil.test.js',
    'packages/brain/--pool=forks.test.js',
  ])('keeps option-shaped target positional: %s', async ref => {
    const command = await assertionCommand(ref, ROOT, deps);
    expect(command.argv.at(-2)).toBe(`./${ref.slice('packages/brain/'.length)}`);
    expect(command.argv.at(-1)).toBe('--');
  });

  it('executes the same canonical paths recorded in the toolchain', async () => {
    const command = await assertionCommand(
      'packages/brain/src/example.test.js', ROOT, deps,
    );
    expect(command.executable).toBe('/tools/node-real');
    expect(command.argv[0]).toBe(join(ROOT, 'node_modules/vitest/vitest.mjs'));
    expect(command.options.toolchain.map(item => item.path))
      .toEqual([command.executable, command.argv[0]]);
  });

  it.each([
    [undefined, 'ASSERTION_TOOLCHAIN_REQUIRED'],
    [{ ...TOOLS, python: { path: 'python3', sha256: SHA } },
      'ASSERTION_TOOLCHAIN_PATH_INVALID'],
    [{ ...TOOLS, bash: { path: '/bin/bash', sha256: 'latest' } },
      'ASSERTION_TOOLCHAIN_DIGEST_INVALID'],
  ])('fails closed for unsafe toolchain %#', async (toolchains, code) => {
    await expect(assertionCommand('services/tests/test_gp.py', ROOT, {
      ...deps, toolchains,
    })).rejects.toMatchObject({ code });
  });

  it('does not accept caller environment values', async () => {
    const command = await assertionCommand('scripts/smoke/gp.sh', ROOT, {
      ...deps,
      env: { PATH: '/attacker', DATABASE_URL: 'secret' },
    });
    expect(command.options.env).toEqual({ inherit: false, allowlist: [] });
    expect(JSON.stringify(command)).not.toContain('secret');
    expect(JSON.stringify(command)).not.toContain('/attacker');
  });

  it.each(['&&', ';', '|', '`id`', '$(id)', '"quoted"'])(
    'rejects shell syntax %s',
    async token => {
      await expect(assertionCommand(
        `manual:npx vitest run packages/brain/src/example.test.js ${token}`,
        ROOT,
        deps,
      )).rejects.toMatchObject({ code: 'UNSAFE_ASSERTION_COMMAND' });
    },
  );

  it.each(['/tmp/evil.test.js', '../evil.test.js'])(
    'rejects path escape %s',
    async ref => {
      await expect(assertionCommand(ref, ROOT, deps))
        .rejects.toMatchObject({ code: 'ASSERTION_PATH_ESCAPE' });
    },
  );

  it('rejects symlink escape and untracked canonical targets', async () => {
    const escaped = {
      ...deps,
      realpathFn: vi.fn(async path => (
        path === ROOT ? ROOT : '/outside/evil.test.js'
      )),
    };
    await expect(assertionCommand(
      'packages/brain/src/example.test.js', ROOT, escaped,
    )).rejects.toMatchObject({ code: 'ASSERTION_PATH_ESCAPE' });
    await expect(assertionCommand('packages/brain/src/example.test.js', ROOT, {
      ...deps, isTrackedPathFn: vi.fn(async () => false),
    })).rejects.toMatchObject({ code: 'ASSERTION_PATH_UNTRACKED' });
  });

  it.each([
    ['https://token@github.com/OpenAI/cecelia.git', 'github.com/OpenAI/cecelia'],
    ['git@GitHub.com:OpenAI/cecelia.git', 'github.com/OpenAI/cecelia'],
  ])('canonicalizes origin without credentials', (origin, expected) => {
    expect(canonicalRepoIdentity(origin)).toBe(expected);
  });
});
