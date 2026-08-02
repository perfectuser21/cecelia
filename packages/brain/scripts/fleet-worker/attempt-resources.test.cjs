'use strict';

const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const POSTGRES_IMAGE = `postgres:16-alpine@sha256:${'f'.repeat(64)}`;

function loadResourceManager() {
  const loaded = require('./attempt-resources.cjs');
  expect(loaded.createAttemptResourceManager).toBeTypeOf('function');
  return loaded.createAttemptResourceManager;
}

describe('Fleet Worker Attempt runtime resources', () => {
  it('creates a private network and healthy pinned PostgreSQL sidecar with ephemeral credentials', async () => {
    const createAttemptResourceManager = loadResourceManager();
    const calls = [];
    const runCommand = vi.fn(async (command, args) => {
      calls.push([command, args]);
      if (args[0] === 'exec') return { stdout: 'postgres:5432 - accepting connections' };
      return { stdout: args[0] === 'run' ? 'postgres-container-id' : '' };
    });
    const manager = createAttemptResourceManager({
      runCommand,
      postgresImageDigest: POSTGRES_IMAGE,
      randomBytesFn: () => Buffer.from('0123456789abcdef0123456789abcdef'),
      waitFn: vi.fn(async () => {}),
    });

    const provisioned = await manager.provision({
      attemptId: ATTEMPT_ID,
      requirements: { postgres: true },
    });

    expect(calls[0]).toEqual([
      'docker',
      expect.arrayContaining([
        'network',
        'create',
        '--label',
        `cecelia.fleet.attempt_id=${ATTEMPT_ID}`,
      ]),
    ]);
    expect(calls[1]).toEqual([
      'docker',
      expect.arrayContaining([
        'run',
        '--detach',
        '--network-alias',
        'postgres',
        POSTGRES_IMAGE,
      ]),
    ]);
    expect(calls[2]).toEqual([
      'docker',
      expect.arrayContaining([
        'exec',
        '--',
        `cecelia-pg-${ATTEMPT_ID}`,
        'pg_isready',
        '-U',
        '-d',
      ]),
    ]);
    expect(provisioned.networkName).toBe(`cecelia-attempt-${ATTEMPT_ID}`);
    expect(provisioned.environment.DB_URL).toMatch(
      /^postgresql:\/\/attempt_[a-f0-9]+:[a-f0-9]+@postgres:5432\/acceptance_[a-f0-9]+$/,
    );
    expect(provisioned.environment.DATABASE_URL).toBe(
      provisioned.environment.DB_URL,
    );
    expect(provisioned.runtime).toEqual({
      postgres: {
        container_name: `cecelia-pg-${ATTEMPT_ID}`,
        network_name: `cecelia-attempt-${ATTEMPT_ID}`,
        image_digest: POSTGRES_IMAGE,
      },
    });
    expect(JSON.stringify(provisioned.runtime)).not.toContain(
      provisioned.environment.DB_URL,
    );
  });

  it('fails closed and removes owned partial resources when PostgreSQL never becomes healthy', async () => {
    const createAttemptResourceManager = loadResourceManager();
    const runCommand = vi.fn(async (_command, args) => {
      if (args[0] === 'exec') throw new Error('postgres not ready');
      return { stdout: args[0] === 'run' ? 'postgres-container-id' : '' };
    });
    const manager = createAttemptResourceManager({
      runCommand,
      postgresImageDigest: POSTGRES_IMAGE,
      randomBytesFn: () => Buffer.alloc(32, 7),
      waitFn: vi.fn(async () => {}),
      healthAttempts: 2,
    });

    await expect(manager.provision({
      attemptId: ATTEMPT_ID,
      requirements: { postgres: true },
    })).rejects.toThrow('attempt_postgres_not_ready');

    expect(runCommand).toHaveBeenCalledWith('docker', [
      'rm',
      '-f',
      '--',
      `cecelia-pg-${ATTEMPT_ID}`,
    ]);
    expect(runCommand).toHaveBeenCalledWith('docker', [
      'network',
      'rm',
      '--',
      `cecelia-attempt-${ATTEMPT_ID}`,
    ]);
  });

  it('releases only deterministic resources owned by the exact Attempt', async () => {
    const createAttemptResourceManager = loadResourceManager();
    const runCommand = vi.fn(async () => ({ stdout: '' }));
    const manager = createAttemptResourceManager({
      runCommand,
      postgresImageDigest: POSTGRES_IMAGE,
    });

    await expect(manager.release({
      attemptId: ATTEMPT_ID,
      runtime: {
        postgres: {
          container_name: `cecelia-pg-${ATTEMPT_ID}`,
          network_name: `cecelia-attempt-${ATTEMPT_ID}`,
          image_digest: POSTGRES_IMAGE,
        },
      },
    })).resolves.toEqual({ status: 'released' });

    expect(runCommand.mock.calls).toEqual([
      ['docker', ['rm', '-f', '--', `cecelia-pg-${ATTEMPT_ID}`]],
      ['docker', ['network', 'rm', '--', `cecelia-attempt-${ATTEMPT_ID}`]],
    ]);
  });

  it('releases an exact historical Attempt after the configured pinned digest changes', async () => {
    const createAttemptResourceManager = loadResourceManager();
    const previousPinnedImage = `postgres:16-alpine@sha256:${'a'.repeat(64)}`;
    const runCommand = vi.fn(async () => ({ stdout: '' }));
    const manager = createAttemptResourceManager({
      runCommand,
      postgresImageDigest: POSTGRES_IMAGE,
    });

    await expect(manager.release({
      attemptId: ATTEMPT_ID,
      runtime: {
        postgres: {
          container_name: `cecelia-pg-${ATTEMPT_ID}`,
          network_name: `cecelia-attempt-${ATTEMPT_ID}`,
          image_digest: previousPinnedImage,
        },
      },
    })).resolves.toEqual({ status: 'released' });

    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it('treats explicit missing resources as idempotent but propagates real removal failures', async () => {
    const createAttemptResourceManager = loadResourceManager();
    const runtime = {
      postgres: {
        container_name: `cecelia-pg-${ATTEMPT_ID}`,
        network_name: `cecelia-attempt-${ATTEMPT_ID}`,
        image_digest: POSTGRES_IMAGE,
      },
    };
    const missingManager = createAttemptResourceManager({
      runCommand: vi.fn(async () => {
        throw new Error('Error response from daemon: No such container');
      }),
      postgresImageDigest: POSTGRES_IMAGE,
    });
    await expect(missingManager.release({
      attemptId: ATTEMPT_ID,
      runtime,
    })).resolves.toEqual({ status: 'released' });

    const deniedManager = createAttemptResourceManager({
      runCommand: vi.fn(async () => {
        throw new Error('permission denied while removing resource');
      }),
      postgresImageDigest: POSTGRES_IMAGE,
    });
    await expect(deniedManager.release({
      attemptId: ATTEMPT_ID,
      runtime,
    })).rejects.toThrow('attempt_resource_release_failed');
  });

  it('reconciles only labelled deterministic orphan resources outside the retained set', async () => {
    const createAttemptResourceManager = loadResourceManager();
    const retainedAttemptId = '33333333-3333-4333-8333-333333333333';
    const foreignAttemptId = '44444444-4444-4444-8444-444444444444';
    const runCommand = vi.fn(async (_command, args) => {
      if (args[0] === 'ps') {
        return {
          stdout: [
            `cecelia-pg-${ATTEMPT_ID}\t${ATTEMPT_ID}`,
            `cecelia-pg-${retainedAttemptId}\t${retainedAttemptId}`,
            `operator-postgres\t${foreignAttemptId}`,
          ].join('\n'),
        };
      }
      if (args[0] === 'network' && args[1] === 'ls') {
        return {
          stdout: [
            `cecelia-attempt-${ATTEMPT_ID}\t${ATTEMPT_ID}`,
            `cecelia-attempt-${retainedAttemptId}\t${retainedAttemptId}`,
          ].join('\n'),
        };
      }
      return { stdout: '' };
    });
    const manager = createAttemptResourceManager({
      runCommand,
      postgresImageDigest: POSTGRES_IMAGE,
    });

    await expect(manager.reconcile({
      retainedAttemptIds: [retainedAttemptId],
    })).resolves.toEqual({ removed_attempts: [ATTEMPT_ID] });

    expect(runCommand).toHaveBeenCalledWith('docker', [
      'rm',
      '-f',
      '--',
      `cecelia-pg-${ATTEMPT_ID}`,
    ]);
    expect(runCommand).toHaveBeenCalledWith('docker', [
      'network',
      'rm',
      '--',
      `cecelia-attempt-${ATTEMPT_ID}`,
    ]);
    expect(JSON.stringify(runCommand.mock.calls)).not.toContain(
      `cecelia-pg-${retainedAttemptId}`,
    );
    expect(runCommand).not.toHaveBeenCalledWith('docker', [
      'rm',
      '-f',
      '--',
      'operator-postgres',
    ]);
  });
});
