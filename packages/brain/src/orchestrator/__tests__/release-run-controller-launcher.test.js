import { describe, expect, it, vi } from 'vitest';

import {
  buildProductionControllerArgs,
  buildRollbackControllerArgs,
  launchRollbackController,
  resolveRollbackControllerRuntime,
} from '../release-run-controller-launcher.js';

const base = {
  image: `sha256:${'a'.repeat(64)}`,
  network: 'cecelia_default',
  repoRoot: '/deploy',
  privateConfigFile:
    '/deploy/logs/.kernel-release-workers/cecelia-release-worker-test/authority.json',
  logFile: '/deploy/logs/cecelia-release-controller-test.log',
  claimId: 72,
  generation: 1,
  ownerNonce: 'f'.repeat(64),
  workerEnvironment: {
    KERNEL_RELEASE_RUN_ID: '44444444-4444-4444-8444-444444444444',
    KERNEL_RELEASE_PRIVATE_CONFIG_FILE:
      '/deploy/logs/.kernel-release-workers/cecelia-release-worker-test/authority.json',
  },
};

function exactReconcileExec(planned, {
  tmpfs = { '/tmp': 'size=104857600' },
} = {}) {
  return vi.fn((_command, args) => {
    if (args[0] === 'ps') return 'controller-id\n';
    if (args[0] === 'image') {
      return JSON.stringify({
        Env: ['PATH=/usr/bin', 'NODE_ENV=production'],
        Labels: { 'org.opencontainers.image.source': 'cecelia' },
      });
    }
    return JSON.stringify({
      Name: `/${planned.name}`,
      Image: base.image,
      State: { Running: true },
      Config: {
        Image: base.image,
        WorkingDir: base.repoRoot,
        Env: [
          'PATH=/usr/bin',
          'NODE_ENV=production',
          ...planned.expectedEnvironmentEntries,
        ],
        Labels: {
          'org.opencontainers.image.source': 'cecelia',
          ...planned.expectedLabels,
        },
        Cmd: planned.command,
        Healthcheck: { Test: ['NONE'] },
      },
      HostConfig: {
        Binds: [...planned.binds],
        NetworkMode: base.network,
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        PidsLimit: 128,
        Memory: 512 * 1024 * 1024,
        NanoCpus: 1_000_000_000,
        RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 3 },
        Tmpfs: tmpfs,
      },
    });
  });
}

describe('external ReleaseRun controller launcher', () => {
  it('pins the current immutable Brain image and exact compose network', () => {
    const exec = vi.fn((_command, args) => (
      args[3] === '{{.Image}}'
        ? `${base.image}\n`
        : 'cecelia_default\n'
    ));
    expect(resolveRollbackControllerRuntime({ exec })).toEqual({
      image: base.image,
      network: 'cecelia_default',
    });
  });

  it.each([
    ['production', buildProductionControllerArgs, 'release-run-effect-worker.mjs'],
    ['rollback', buildRollbackControllerArgs, 'release-run-rollback-worker.mjs'],
  ])('builds a hardened sibling %s controller with no authority secret in argv', (
    kind,
    build,
    worker,
  ) => {
    const planned = build(base);
    expect(planned.name).toBe(`cecelia-release-${kind}-72-1`);
    expect(planned.args).toEqual(expect.arrayContaining([
      '--read-only',
      '--restart',
      'on-failure:3',
      '--no-healthcheck',
      '--cap-drop',
      'ALL',
      '--network',
      'cecelia_default',
      base.image,
      `/repo/scripts/lib/${worker}`,
    ]));
    expect(planned.args).toContain(
      'exec node "$1" >> "$KERNEL_RELEASE_CONTROLLER_LOG_FILE" 2>&1',
    );
    expect(planned.args.join('\n'))
      .toContain(`KERNEL_RELEASE_CONTROLLER_LOG_FILE=${base.logFile}`);
    expect(planned.args.join('\n')).not.toContain('rollback_authorization');
    expect(planned.args.join('\n')).toContain('KERNEL_RELEASE_EXTERNAL_CONTROLLER=1');
  });

  it('waits for docker to confirm sibling creation before accepting', async () => {
    const child = {
      once: vi.fn((event, callback) => {
        if (event === 'close') queueMicrotask(() => callback(0));
      }),
    };
    const spawnFn = vi.fn(() => child);
    const planned = buildRollbackControllerArgs(base);
    const execFn = exactReconcileExec(planned);
    await expect(launchRollbackController(base, {
      spawnFn,
      execFn,
    })).resolves.toEqual({
      name: 'cecelia-release-rollback-72-1',
    });
    expect(spawnFn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['run', '-d', '--restart', 'on-failure:3']),
      { cwd: '/deploy', stdio: 'ignore' },
    );
    expect(spawnFn.mock.calls[0][1]).not.toContain('--rm');
    expect(execFn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['inspect', planned.name]),
      { encoding: 'utf8' },
    );
  });

  it('accepts the exact 100 MiB tmpfs when Docker preserves the CLI unit', async () => {
    const child = {
      once: vi.fn((event, callback) => {
        if (event === 'close') queueMicrotask(() => callback(0));
      }),
    };
    const planned = buildRollbackControllerArgs(base);
    await expect(launchRollbackController(base, {
      spawnFn: vi.fn(() => child),
      execFn: exactReconcileExec(planned, {
        tmpfs: { '/tmp': 'size=100M' },
      }),
    })).resolves.toEqual({
      name: 'cecelia-release-rollback-72-1',
    });
  });

  it('allows a later production generation while rollback remains generation one only', () => {
    const production = buildProductionControllerArgs({
      ...base,
      generation: 2,
    });
    expect(production.name).toBe('cecelia-release-production-72-2');
    expect(production.args).toContain('cecelia.release.generation=2');
    expect(() => buildRollbackControllerArgs({
      ...base,
      generation: 2,
    })).toThrow('release_rollback_controller_request_invalid');
  });

  it('reconciles a non-zero docker CLI result against the exact durable container', async () => {
    const child = {
      once: vi.fn((event, callback) => {
        if (event === 'close') queueMicrotask(() => callback(1));
      }),
    };
    const spawnFn = vi.fn(() => child);
    const planned = buildRollbackControllerArgs(base);
    const execFn = vi.fn((_command, args) => {
      if (args[0] === 'ps') return 'controller-id\n';
      if (args[0] === 'image') {
        return JSON.stringify({
          Env: ['PATH=/usr/bin', 'NODE_ENV=production'],
          Labels: { 'org.opencontainers.image.source': 'cecelia' },
        });
      }
      return JSON.stringify({
        Name: '/cecelia-release-rollback-72-1',
        Image: base.image,
        State: { Running: true },
        Config: {
          Image: base.image,
          WorkingDir: '/deploy',
          Env: [
            'PATH=/usr/bin',
            'NODE_ENV=production',
            ...planned.expectedEnvironmentEntries,
          ],
          Labels: {
            'org.opencontainers.image.source': 'cecelia',
            'cecelia.release.kind': 'rollback',
            'cecelia.release.claim-id': '72',
            'cecelia.release.generation': '1',
            'cecelia.release.owner-nonce': base.ownerNonce,
          },
          Cmd: planned.command,
          Healthcheck: { Test: ['NONE'] },
        },
        HostConfig: {
          Binds: [
            '/var/run/docker.sock:/var/run/docker.sock',
            '/deploy:/deploy:rw',
            '/deploy/logs/.kernel-release-workers/cecelia-release-worker-test:/deploy/logs/.kernel-release-workers/cecelia-release-worker-test:rw',
          ],
          NetworkMode: 'cecelia_default',
          ReadonlyRootfs: true,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
          PidsLimit: 128,
          Memory: 512 * 1024 * 1024,
          NanoCpus: 1_000_000_000,
          RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 3 },
          Tmpfs: { '/tmp': 'size=104857600' },
        },
      });
    });
    await expect(launchRollbackController(base, {
      spawnFn,
      execFn,
    })).resolves.toEqual({
      name: 'cecelia-release-rollback-72-1',
      reconciled: true,
    });
  });

  it.each([
    ['stopped controller', (observed) => { observed.State.Running = false; }],
    ['changed command prefix', (observed) => { observed.Config.Cmd[0] = 'bash'; }],
    ['missing exact environment', (observed) => { observed.Config.Env.pop(); }],
    ['changed environment', (observed) => { observed.Config.Env.push('EXTRA=1'); }],
    ['missing tmpfs', (observed) => { observed.HostConfig.Tmpfs = {}; }],
    ['undersized tmpfs', (observed) => {
      observed.HostConfig.Tmpfs = { '/tmp': 'size=99M' };
    }],
    ['extra tmpfs option', (observed) => {
      observed.HostConfig.Tmpfs = { '/tmp': 'size=100M,rw' };
    }],
    ['extra tmpfs mount', (observed) => {
      observed.HostConfig.Tmpfs = {
        '/tmp': 'size=100M',
        '/run': 'size=1M',
      };
    }],
    ['case-changed tmpfs key', (observed) => {
      observed.HostConfig.Tmpfs = { '/tmp': 'SIZE=100M' };
    }],
    ['lowercase tmpfs unit', (observed) => {
      observed.HostConfig.Tmpfs = { '/tmp': 'size=100m' };
    }],
    ['malformed byte suffix', (observed) => {
      observed.HostConfig.Tmpfs = { '/tmp': 'size=104857600iB' };
    }],
    ['active healthcheck', (observed) => {
      observed.Config.Healthcheck = { Test: ['CMD', 'curl', 'localhost'] };
    }],
    ['wrong owner nonce', (observed) => {
      observed.Config.Labels['cecelia.release.owner-nonce'] = '0'.repeat(64);
    }],
  ])('rejects identity reconciliation for %s', async (_name, mutate) => {
    const child = {
      once: vi.fn((event, callback) => {
        if (event === 'close') queueMicrotask(() => callback(1));
      }),
    };
    const planned = buildRollbackControllerArgs(base);
    const observed = {
      Name: `/${planned.name}`,
      Image: base.image,
      State: { Running: true },
      Config: {
        Image: base.image,
        WorkingDir: base.repoRoot,
        Env: [
          'PATH=/usr/bin',
          'NODE_ENV=production',
          ...planned.expectedEnvironmentEntries,
        ],
        Labels: {
          'org.opencontainers.image.source': 'cecelia',
          'cecelia.release.kind': 'rollback',
          'cecelia.release.claim-id': '72',
          'cecelia.release.owner-nonce': base.ownerNonce,
        },
        Cmd: [...planned.command],
        Healthcheck: { Test: ['NONE'] },
      },
      HostConfig: {
        Binds: [...planned.binds],
        NetworkMode: base.network,
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        PidsLimit: 128,
        Memory: 512 * 1024 * 1024,
        NanoCpus: 1_000_000_000,
        RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 3 },
        Tmpfs: { '/tmp': 'size=104857600' },
      },
    };
    mutate(observed);
    const execFn = vi.fn((_command, args) => {
      if (args[0] === 'ps') return 'controller-id\n';
      if (args[0] === 'image') {
        return JSON.stringify({
          Env: ['PATH=/usr/bin', 'NODE_ENV=production'],
          Labels: { 'org.opencontainers.image.source': 'cecelia' },
        });
      }
      return JSON.stringify(observed);
    });
    await expect(launchRollbackController(base, {
      spawnFn: vi.fn(() => child),
      execFn,
    })).rejects.toMatchObject({
      code: 'release_controller_identity_collision',
    });
  });

  it('reports an ambiguous launch without falsely declaring the effect failed', async () => {
    const child = {
      once: vi.fn((event, callback) => {
        if (event === 'close') queueMicrotask(() => callback(1));
      }),
    };
    await expect(launchRollbackController(base, {
      spawnFn: vi.fn(() => child),
      execFn: vi.fn(() => {
        throw new Error('docker daemon response unavailable');
      }),
    })).rejects.toMatchObject({
      code: 'release_controller_launch_outcome_unknown',
    });
  });

  it('rejects a code-zero launch when post-create readback is not running', async () => {
    const child = {
      once: vi.fn((event, callback) => {
        if (event === 'close') queueMicrotask(() => callback(0));
      }),
    };
    const planned = buildRollbackControllerArgs(base);
    const execFn = exactReconcileExec(planned);
    const original = execFn.getMockImplementation();
    execFn.mockImplementation((command, args) => {
      const value = original(command, args);
      if (args[0] !== 'inspect') return value;
      const observed = JSON.parse(value);
      observed.State.Running = false;
      return JSON.stringify(observed);
    });
    await expect(launchRollbackController(base, {
      spawnFn: vi.fn(() => child),
      execFn,
    })).rejects.toMatchObject({
      code: 'release_controller_identity_collision',
    });
  });

  it('rejects mounts that could shadow the immutable controller runtime', () => {
    for (const repoRoot of ['/', '/repo', '//repo', '/tmp/../repo']) {
      expect(() => buildRollbackControllerArgs({
        ...base,
        repoRoot,
        logFile: `${repoRoot}/logs/controller.log`,
      })).toThrow('release_rollback_controller_request_invalid');
    }
    for (const deployRoot of ['/', '/app/skills', '//repo', '/tmp/../app']) {
      expect(() => buildRollbackControllerArgs({
        ...base,
        workerEnvironment: {
          ...base.workerEnvironment,
          CECELIA_SKILLS_DEPLOY_ROOTS: deployRoot,
        },
      })).toThrow('release_rollback_controller_request_invalid');
    }
  });
});
