'use strict';

const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const REPO = 'perfectuser21/cecelia';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_A = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_B = '33333333-3333-4333-8333-333333333333';

function loadWorkspaceManager() {
  return require('./workspace-manager.cjs');
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function runCommand(command, args, options = {}) {
  const { stdout = '' } = await execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
  });
  return { stdout: stdout.trim() };
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-workspace-test-'));
  const source = path.join(root, 'source');
  const remote = path.join(root, 'remote.git');
  fs.mkdirSync(source);
  git(['init', '--initial-branch=main'], source);
  git(['config', 'user.name', 'Fleet Test'], source);
  git(['config', 'user.email', 'fleet-test@example.invalid'], source);
  fs.writeFileSync(path.join(source, 'README.md'), 'fleet workspace\n');
  git(['add', 'README.md'], source);
  git(['commit', '-m', 'fixture'], source);
  const sha = git(['rev-parse', 'HEAD'], source);
  git(['clone', '--bare', source, remote], root);
  return {
    root,
    remote,
    sha,
    mirrorRoot: path.join(root, 'mirrors'),
    worktreeRoot: path.join(root, 'worktrees'),
    quarantineRoot: path.join(root, 'quarantine'),
  };
}

function spec(fixture, overrides = {}) {
  return {
    repo: REPO,
    base_sha: fixture.sha,
    branch: 'cp-07272050-writer-a',
    expected_head_sha: null,
    mode: 'read-write',
    run_id: RUN_ID,
    attempt_id: ATTEMPT_A,
    ...overrides,
  };
}

function createManager(fixture, overrides = {}) {
  const { createWorkspaceManager } = loadWorkspaceManager();
  return createWorkspaceManager({
    mirrorRoot: fixture.mirrorRoot,
    worktreeRoot: fixture.worktreeRoot,
    quarantineRoot: fixture.quarantineRoot,
    repoAllowlist: { [REPO]: fixture.remote },
    runCommand,
    ...overrides,
  });
}

describe('Fleet Worker workspace manager', () => {
  let fixture;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  it('creates two concurrent writer Attempts in different owned worktrees', async () => {
    const manager = createManager(fixture);

    const [first, second] = await Promise.all([
      manager.prepare(spec(fixture)),
      manager.prepare(spec(fixture, {
        attempt_id: ATTEMPT_B,
        branch: 'cp-07272050-writer-b',
      })),
    ]);

    expect(first.path).not.toBe(second.path);
    expect(first.admin_path).not.toBe(second.admin_path);
    expect(first.admin_path).not.toBe(first.mirror_path);
    expect(second.admin_path).not.toBe(second.mirror_path);
    expect(first.admin_path.startsWith(
      `${fixture.worktreeRoot}${path.sep}.admin${path.sep}`,
    )).toBe(true);
    expect(second.admin_path.startsWith(
      `${fixture.worktreeRoot}${path.sep}.admin${path.sep}`,
    )).toBe(true);
    expect(first.path.startsWith(`${fixture.worktreeRoot}${path.sep}`)).toBe(true);
    expect(second.path.startsWith(`${fixture.worktreeRoot}${path.sep}`)).toBe(true);
    expect(git(['rev-parse', 'HEAD'], first.path)).toBe(fixture.sha);
    expect(git(['rev-parse', 'HEAD'], second.path)).toBe(fixture.sha);
    expect(git(['rev-parse', '--absolute-git-dir'], first.path)).toContain(
      first.admin_path,
    );
    expect(git(['rev-parse', '--absolute-git-dir'], second.path)).toContain(
      second.admin_path,
    );
    expect(git(['remote', 'get-url', 'origin'], first.path)).toBe(fixture.remote);
    expect(git(['remote', 'get-url', 'origin'], second.path)).toBe(fixture.remote);
    expect(first.owner).toEqual({
      run_id: RUN_ID,
      attempt_id: ATTEMPT_A,
    });
    expect(second.owner.attempt_id).toBe(ATTEMPT_B);
  });

  it('rejects caller cwd before any Git side effect', async () => {
    const commandSpy = vi.fn(runCommand);
    const manager = createManager(fixture, { runCommand: commandSpy });

    await expect(manager.prepare(spec(fixture, {
      cwd: '/Users/operator/perfect21/cecelia',
    }))).rejects.toThrow(/workspace_spec_unknown_field:cwd/);
    expect(commandSpy).not.toHaveBeenCalled();
  });

  it('rejects an expected head that is absent before returning a workspace', async () => {
    const manager = createManager(fixture);
    const missingSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    await expect(manager.prepare(spec(fixture, {
      expected_head_sha: missingSha,
    }))).rejects.toThrow(/workspace_expected_head_unavailable/);
    expect(fs.existsSync(path.join(fixture.worktreeRoot, ATTEMPT_A))).toBe(false);
  });

  it('removes an owned worktree idempotently', async () => {
    const manager = createManager(fixture);
    const workspace = await manager.prepare(spec(fixture));

    await expect(manager.cleanup(workspace)).resolves.toMatchObject({
      status: 'cleaned',
      attempt_id: ATTEMPT_A,
    });
    expect(fs.existsSync(workspace.admin_path)).toBe(false);
    await expect(manager.cleanup(workspace)).resolves.toMatchObject({
      status: 'already_clean',
      attempt_id: ATTEMPT_A,
    });
    expect(fs.existsSync(workspace.path)).toBe(false);
  });

  it('restart reconciliation removes an unretained owned worktree only', async () => {
    const manager = createManager(fixture);
    const orphan = await manager.prepare(spec(fixture));
    const retained = await manager.prepare(spec(fixture, {
      attempt_id: ATTEMPT_B,
      branch: 'cp-07272050-retained',
    }));

    await expect(manager.reconcile({
      retainedAttemptIds: [ATTEMPT_B],
    })).resolves.toEqual({
      cleaned_attempts: [ATTEMPT_A],
    });
    expect(fs.existsSync(orphan.path)).toBe(false);
    expect(fs.existsSync(orphan.admin_path)).toBe(false);
    expect(fs.existsSync(retained.path)).toBe(true);
    expect(fs.existsSync(retained.admin_path)).toBe(true);
    expect(git(['rev-parse', 'HEAD'], retained.path)).toBe(fixture.sha);
  });

  it('quarantines the workspace when Git cleanup fails', async () => {
    const manager = createManager(fixture);
    const workspace = await manager.prepare(spec(fixture));
    const failingManager = createManager(fixture, {
      runCommand: async (command, args, options) => {
        if (args[0] === '--git-dir' && args.includes('worktree') && args.includes('remove')) {
          throw new Error('simulated git worktree remove failure');
        }
        return runCommand(command, args, options);
      },
    });

    const result = await failingManager.cleanup(workspace);

    expect(result.status).toBe('quarantined');
    expect(result.reason).toMatch(/simulated git worktree remove failure/);
    expect(result.path.startsWith(`${fixture.quarantineRoot}${path.sep}`)).toBe(true);
    expect(fs.existsSync(result.path)).toBe(true);
    expect(fs.existsSync(workspace.path)).toBe(false);
  });
});
