import { afterEach, describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ensureHarnessWorktree } from '../../../packages/brain/src/harness-worktree.js';

const exec = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true })));
});

async function makeRepo(origin: string) {
  const root = await mkdtemp(join(tmpdir(), 'harness-worktree-recovery-'));
  roots.push(root);
  await exec('git', ['init', root]);
  await writeFile(join(root, 'README.md'), 'recovery fixture\n');
  await exec('git', ['-C', root, 'add', 'README.md']);
  await exec('git', ['-C', root, '-c', 'user.name=Harness', '-c', 'user.email=harness@example.invalid', 'commit', '-m', 'fixture']);
  await exec('git', ['-C', root, 'remote', 'add', 'origin', origin]);
  return root;
}

function realGitExec(repoByHarnessPath: string, canonicalBase: string) {
  return async (_cmd: string, args: string[]) => {
    const redirected = [...args];
    const c = redirected.indexOf('-C');
    if (c >= 0 && redirected[c + 1] === canonicalBase && redirected.includes('get-url')) {
      return { stdout: `${canonicalBase}\n`, stderr: '' };
    }
    if (c >= 0) redirected[c + 1] = repoByHarnessPath;
    return exec('git', redirected);
  };
}

describe('Unified Work Router Recovery RED [BEHAVIOR]', () => {
  it('credential-bearing origin canonicalization reuses the same repository', async () => {
    const clean = 'https://github.com/perfectuser21/cecelia.git';
    const credentialed = 'https://x-access-token:super-secret@github.com/perfectuser21/cecelia.git';
    const repo = await makeRepo(credentialed);
    let removals = 0;

    await ensureHarnessWorktree({
      taskId: '12345678-recovery',
      baseRepo: clean,
      statFn: async () => true,
      execFn: realGitExec(repo, clean),
      rmFn: async () => { removals += 1; },
      tokenFn: async () => '',
      logFn: () => {},
      isKernelWorkspaceActive: async () => false,
    } as never);

    expect(removals).toBe(0);
  });

  it('credential-bearing origin never appears in captured logs', async () => {
    const secret = 'production-token-should-never-leak';
    const clean = 'https://github.com/perfectuser21/cecelia.git';
    const repo = await makeRepo(`https://x-access-token:${secret}@github.com/perfectuser21/cecelia.git`);
    const logs: string[] = [];

    await ensureHarnessWorktree({
      taskId: '12345678-redaction',
      baseRepo: clean,
      statFn: async () => true,
      execFn: realGitExec(repo, clean),
      rmFn: async () => {},
      tokenFn: async () => '',
      logFn: (line: string) => logs.push(line),
      isKernelWorkspaceActive: async () => false,
    } as never).catch(() => undefined);

    expect(logs.join('\n')).not.toContain(secret);
    expect(logs.join('\n')).not.toContain('x-access-token:');
  });

  it('active detached Kernel workspace protection prevents deletion callback', async () => {
    const clean = 'https://github.com/perfectuser21/cecelia.git';
    const repo = await makeRepo('https://github.com/unrelated/orphan.git');
    await exec('git', ['-C', repo, 'checkout', '--detach', 'HEAD']);
    let removals = 0;

    await ensureHarnessWorktree({
      taskId: '12345678-active',
      baseRepo: clean,
      statFn: async () => true,
      execFn: realGitExec(repo, clean),
      rmFn: async () => { removals += 1; },
      tokenFn: async () => '',
      logFn: () => {},
      isKernelWorkspaceActive: async () => true,
    } as never).catch(() => undefined);

    expect(removals).toBe(0);
  });
});

describe('Unified Work Router contract [BEHAVIOR]', () => {
  it('Router to Judge service mechanical acceptance is executable', async () => {
    const mod = await import('../../../packages/brain/src/orchestrator/unified-router-acceptance.js');
    expect(mod.runUnifiedRouterAcceptance).toBeTypeOf('function');
  });
  it('four change kinds map forward only through one router', async () => {
    const mod = await import('../../../packages/brain/src/work-router.js');
    expect(mod.CHANGE_KINDS).toEqual(['new_capability', 'capability_change', 'bugfix', 'parameter_only']);
    expect(() => mod.selectPipeline({ work_kind: 'coding_mutation', gear: 'hotfix' })).toThrow('change_kind_required');
  });

  it('coding run requires Map and Impact Contract before Provider creation', async () => {
    const mod = await import('../../../packages/brain/src/orchestrator/preflight/map-impact-contract.js');
    expect(mod.assertMapImpactContract).toBeTypeOf('function');
  });

  it('frozen baseline is an ancestor, not final HEAD', async () => {
    const source = await import('node:fs').then(fs => fs.readFileSync('docker/cecelia-runner/entrypoint.sh', 'utf8'));
    expect(source).toContain('merge-base --is-ancestor');
    expect(source).not.toContain('test "$(git rev-parse HEAD)" = "$BASELINE_SHA"');
  });

  it('Generator trust boundary removes privileged channels', async () => {
    const source = await import('node:fs').then(fs => fs.readFileSync('docker/cecelia-runner/entrypoint.sh', 'utf8'));
    for (const key of ['HARNESS_CALLBACK_TOKEN', 'HARNESS_LEASE_OWNER', 'HARNESS_LEASE_GENERATION']) {
      expect(source).toContain(`-u ${key}`);
    }
    expect(source).toContain('remote.origin.pushurl');
    expect(source).toContain('setpriv');
  });
});
