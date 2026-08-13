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

function createFixture({ withPackageJson = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-workspace-test-'));
  const source = path.join(root, 'source');
  const remote = path.join(root, 'remote.git');
  fs.mkdirSync(source);
  git(['init', '--initial-branch=main'], source);
  git(['config', 'user.name', 'Fleet Test'], source);
  git(['config', 'user.email', 'fleet-test@example.invalid'], source);
  fs.writeFileSync(path.join(source, 'README.md'), 'fleet workspace\n');
  git(['add', 'README.md'], source);
  if (withPackageJson) {
    fs.writeFileSync(
      path.join(source, 'package.json'),
      `${JSON.stringify({ name: 'fleet-fixture', version: '1.0.0' }, null, 2)}\n`,
    );
    git(['add', 'package.json'], source);
  }
  git(['commit', '-m', 'fixture'], source);
  const sha = git(['rev-parse', 'HEAD'], source);
  git(['clone', '--bare', source, remote], root);
  return {
    root,
    source,
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

  it('从同机 retained Generator admin clone 物化远端不存在的精确候选', async () => {
    const manager = createManager(fixture);
    const generator = await manager.prepare(spec(fixture));
    git(['config', 'user.name', 'Generator Test'], generator.path);
    git(['config', 'user.email', 'generator@example.invalid'], generator.path);
    fs.writeFileSync(path.join(generator.path, 'candidate.txt'), 'candidate\n');
    git(['add', 'candidate.txt'], generator.path);
    git(['commit', '-m', 'feat: local candidate'], generator.path);
    const candidateHead = git(['rev-parse', 'HEAD'], generator.path);
    expect(() => git([
      '--git-dir', fixture.remote, 'cat-file', '-e', `${candidateHead}^{commit}`,
    ], fixture.root)).toThrow();

    const evaluator = await manager.prepare(spec(fixture, {
      attempt_id: ATTEMPT_B,
      branch: 'cp-07272050-writer-a',
      base_sha: candidateHead,
      expected_head_sha: candidateHead,
      mode: 'read-only',
      frozen_baseline: true,
      source_attempt_id: ATTEMPT_A,
    }));

    expect(evaluator).toMatchObject({
      head_sha: candidateHead,
      source_attempt_id: ATTEMPT_A,
    });
    expect(git(['rev-parse', 'HEAD'], evaluator.path)).toBe(candidateHead);
    expect(git(['remote', 'get-url', 'origin'], evaluator.path)).toBe(fixture.remote);
  });

  // The Worker is the only place that observes the real checkout SHA. A frozen
  // Attempt must carry that observation forward, otherwise nothing downstream
  // can prove the Provider never left the pinned baseline.
  it('carries the frozen baseline invariant onto the prepared workspace', async () => {
    const manager = createManager(fixture);

    const workspace = await manager.prepare(spec(fixture, {
      frozen_baseline: true,
    }));

    expect(workspace.frozen_baseline).toBe(true);
    expect(workspace.head_sha).toBe(fixture.sha);
  });

  it('defaults the frozen baseline invariant to false for ordinary dev', async () => {
    const manager = createManager(fixture);

    const workspace = await manager.prepare(spec(fixture));

    expect(workspace.frozen_baseline).toBe(false);
  });

  it('rejects a non-boolean frozen baseline instead of coercing it', async () => {
    const manager = createManager(fixture);

    await expect(manager.prepare(spec(fixture, { frozen_baseline: 'true' })))
      .rejects.toThrow('workspace_frozen_baseline_invalid');
  });

  it('reuses a server-seeded mirror when the requested commit is already present', async () => {
    const manager = createManager(fixture);
    const seeded = await manager.prepare(spec(fixture));
    await manager.cleanup(seeded);
    git([
      '--git-dir',
      seeded.mirror_path,
      'remote',
      'set-url',
      'origin',
      path.join(fixture.root, 'unreachable-origin.git'),
    ], fixture.root);

    const commandSpy = vi.fn(runCommand);
    const offlineManager = createManager(fixture, { runCommand: commandSpy });

    await expect(offlineManager.prepare(spec(fixture, {
      attempt_id: ATTEMPT_B,
      branch: 'cp-07272050-offline-seeded',
    }))).resolves.toMatchObject({
      head_sha: fixture.sha,
      mirror_path: seeded.mirror_path,
    });
    expect(commandSpy.mock.calls.some(([, args]) => args.includes('fetch'))).toBe(false);
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

  it('checks out a verified existing writer branch without colliding with its local ref', async () => {
    const branch = 'cp-07272050-existing-writer';
    git(
      ['--git-dir', fixture.remote, 'branch', branch, fixture.sha],
      fixture.root,
    );
    const branchSha = git(
      ['ls-remote', fixture.remote, `refs/heads/${branch}`],
      fixture.source,
    ).split(/\s+/)[0];
    expect(branchSha).toBe(fixture.sha);
    const manager = createManager(fixture);

    const workspace = await manager.prepare(spec(fixture, {
      branch,
      expected_head_sha: branchSha,
    }));

    expect(workspace.head_sha).toBe(branchSha);
    expect(git(['branch', '--show-current'], workspace.path)).toBe(branch);
    expect(git(['rev-parse', 'HEAD'], workspace.path)).toBe(branchSha);
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

  it('force-cleans exact owned roots for the known mounted-worktree cleanup failure', async () => {
    const manager = createManager(fixture);
    const workspace = await manager.prepare(spec(fixture));
    fs.mkdirSync(path.join(workspace.path, 'node_modules', 'fixture'), {
      recursive: true,
    });
    const failingManager = createManager(fixture, {
      runCommand: async (command, args, options) => {
        if (args[0] === '--git-dir' && args.includes('worktree') && args.includes('remove')) {
          throw new Error(
            "fatal: validation failed, cannot remove working tree: '.git' is not a .git file, error code 7",
          );
        }
        return runCommand(command, args, options);
      },
    });

    const result = await failingManager.cleanup(workspace);

    expect(result).toMatchObject({
      status: 'cleaned',
      attempt_id: ATTEMPT_A,
      forced: true,
    });
    expect(fs.existsSync(workspace.path)).toBe(false);
    expect(fs.existsSync(workspace.admin_path)).toBe(false);
    expect(fs.existsSync(fixture.quarantineRoot)).toBe(false);
  });

  // 运行时依赖预装（design doc §运行时依赖，r17 实证：proposer 的
  // product-map:check 因 fleet workspace 缺 ajv 每轮红）：checkout 后若
  // nodeDeps 打开且 package.json 存在则跑 `npm ci`。真 npm 从不在单测里
  // 执行——注入的 runCommand 拦截 'npm' 调用，其余命令（git）转发给真实实现。
  describe('运行时依赖预装（node_deps）', () => {
    it('nodeDeps=true 且 package.json 存在 → 为 Linux ARM64 runner 安装依赖', async () => {
      const pkgFixture = createFixture({ withPackageJson: true });
      try {
        const npmCalls = [];
        const manager = createManager(pkgFixture, {
          runCommand: async (command, args, options) => {
            if (command === 'npm') {
              npmCalls.push({ args, options });
              return { stdout: '' };
            }
            return runCommand(command, args, options);
          },
        });

        const workspace = await manager.prepare(spec(pkgFixture), { nodeDeps: true });

        expect(npmCalls).toHaveLength(1);
        const [call] = npmCalls;
        // F5：--ignore-scripts 必须在——宿主直接跑 npm ci，生命周期脚本
        // 若不禁用等于把仓库内容当宿主代码执行（docker.sock 沙箱穿透面）。
        expect(call.args).toEqual(['ci', '--no-audit', '--no-fund', '--ignore-scripts']);
        expect(call.options.cwd).toBe(workspace.path);
        // F4：npm_config_cache 显式钉死到机器级目录，env 必须基于
        // process.env 展开（不能只传 {npm_config_cache} 丢光 PATH）。
        expect(call.options.env.npm_config_cache).toBe(manager.roots.npmCache);
        expect(call.options.env.PATH).toBe(process.env.PATH);
        // Fleet worker 跑在 macOS ARM64 宿主，workspace 最终挂进 Linux ARM64
        // runner。npm 默认按宿主平台筛 optionalDependencies，会漏掉 Rollup
        // 等 Linux 原生包；安装目标必须与实际执行容器一致。
        expect(call.options.env.npm_config_os).toBe('linux');
        expect(call.options.env.npm_config_cpu).toBe('arm64');
        expect(call.options.env.npm_config_libc).toBe('glibc');
        // F7：超时 120s（180s prepare 预算内留 60s 余量）+ 8MiB 输出缓冲。
        expect(call.options.timeout).toBe(120_000);
        expect(call.options.maxBuffer).toBe(8 * 1024 * 1024);
        expect(workspace.node_deps).toEqual({ status: 'installed' });
        expect(fs.existsSync(manager.roots.npmCache)).toBe(true);
      } finally {
        fs.rmSync(pkgFixture.root, { recursive: true, force: true });
      }
    });

    it('nodeDeps=true 但没有 package.json → 不跑 npm，标记 skipped_no_package_json', async () => {
      const npmCalls = [];
      const manager = createManager(fixture, {
        runCommand: async (command, args, options) => {
          if (command === 'npm') {
            npmCalls.push({ args, cwd: options?.cwd });
            return { stdout: '' };
          }
          return runCommand(command, args, options);
        },
      });

      const workspace = await manager.prepare(spec(fixture), { nodeDeps: true });

      expect(npmCalls).toEqual([]);
      expect(workspace.node_deps).toEqual({ status: 'skipped_no_package_json' });
    });

    it('nodeDeps 缺省（false）→ 完全不检查/不跑 npm，返回的 workspace 不带 node_deps 字段', async () => {
      const npmCalls = [];
      const manager = createManager(fixture, {
        runCommand: async (command, args, options) => {
          if (command === 'npm') {
            npmCalls.push({ args, cwd: options?.cwd });
            return { stdout: '' };
          }
          return runCommand(command, args, options);
        },
      });

      const workspace = await manager.prepare(spec(fixture));

      expect(npmCalls).toEqual([]);
      expect(workspace).not.toHaveProperty('node_deps');
    });

    it('npm ci 失败不炸 prepare（设计明确要求）——记 warn，workspace 正常返回', async () => {
      const pkgFixture = createFixture({ withPackageJson: true });
      try {
        const manager = createManager(pkgFixture, {
          runCommand: async (command, args, options) => {
            if (command === 'npm') {
              throw new Error('npm ci failed: simulated registry timeout');
            }
            return runCommand(command, args, options);
          },
        });

        const workspace = await manager.prepare(spec(pkgFixture), { nodeDeps: true });

        expect(workspace.node_deps.status).toBe('failed');
        expect(workspace.node_deps.warning).toMatch(/simulated registry timeout/);
        // prepare 没有炸——worktree 依然被正常创建，attempt 可以照常继续跑。
        expect(fs.existsSync(workspace.path)).toBe(true);
      } finally {
        fs.rmSync(pkgFixture.root, { recursive: true, force: true });
      }
    });

    // F7：npm ci 超时必须按普通失败处理，不特殊短路、不炸 prepare。
    it('npm ci 超时（execFile timeout 触发）→ 按失败处理，不炸 prepare', async () => {
      const pkgFixture = createFixture({ withPackageJson: true });
      try {
        const manager = createManager(pkgFixture, {
          runCommand: async (command, args, options) => {
            if (command === 'npm') {
              const timeoutError = new Error('command timed out');
              timeoutError.killed = true;
              timeoutError.signal = 'SIGTERM';
              throw timeoutError;
            }
            return runCommand(command, args, options);
          },
        });

        const workspace = await manager.prepare(spec(pkgFixture), { nodeDeps: true });

        expect(workspace.node_deps.status).toBe('failed');
        expect(workspace.node_deps.warning).toMatch(/timed out/);
        expect(fs.existsSync(workspace.path)).toBe(true);
      } finally {
        fs.rmSync(pkgFixture.root, { recursive: true, force: true });
      }
    });

  });
});
