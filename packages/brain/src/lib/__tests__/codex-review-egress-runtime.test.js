import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildCodexReviewEgressNames,
  cleanupCodexReviewEgress,
  reapExpiredCodexReviewEgress,
  startCodexReviewEgressReaper,
  startCodexReviewEgress,
} from '../codex-review-egress-runtime.js';

const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const IMAGE_ID = `sha256:${'a'.repeat(64)}`;
const OWNER_NONCE = 'f'.repeat(32);
const NOW = new Date('2098-12-31T23:53:00.000Z');
const EXPIRES_AT = '2099-01-01T00:00:00.000Z';

function volumeInspect() {
  return JSON.stringify({
    Name: `cecelia-codex-review-egress-${RUN_ID}`,
    Labels: {
      'cecelia.kind': 'codex-review-egress',
      'cecelia.run_id': RUN_ID,
      'cecelia.owner_nonce': OWNER_NONCE,
      'cecelia.expires_at': EXPIRES_AT,
    },
  });
}

function containerInspect(kind, ownerNonce = OWNER_NONCE, expiresAt = EXPIRES_AT) {
  return JSON.stringify({
    Config: {
      Labels: {
        'cecelia.kind': kind,
        'cecelia.run_id': RUN_ID,
        'cecelia.owner_nonce': ownerNonce,
        'cecelia.expires_at': expiresAt,
      },
    },
  });
}

describe('Codex review egress runtime', () => {
  it('keeps the reviewer bridge on the same named-volume socket contract', () => {
    const bridge = readFileSync(
      new URL('../../../scripts/codex-review-uds-bridge.cjs', import.meta.url),
      'utf8',
    );
    expect(bridge).toContain("const SOCKET_PATH = '/broker/proxy.sock'");
    expect(bridge).not.toContain('/run/codex-review-egress.sock');
  });

  it('uses one private named volume and an unprivileged credential-free broker sidecar', async () => {
    const execute = vi.fn(async (_bin, args) => {
      if (args[0] === 'volume' && args[1] === 'inspect') {
        return volumeInspect();
      }
      if (args[0] === 'run' && args.includes('--detach')) return 'broker-id\n';
      return '';
    });

    const runtime = await startCodexReviewEgress({
      dockerBin: '/usr/bin/docker',
      imageId: IMAGE_ID,
      runId: RUN_ID,
      execute,
      wait: vi.fn(async () => {}),
      now: () => NOW,
      ownerNonce: OWNER_NONCE,
    });

    expect(runtime).toMatchObject(buildCodexReviewEgressNames(RUN_ID));
    expect(execute.mock.calls.map(([, args]) => args)).toEqual([
      expect.arrayContaining([
        'volume', 'create',
        '--label', 'cecelia.kind=codex-review-egress',
        '--label', `cecelia.run_id=${RUN_ID}`,
        `cecelia-codex-review-egress-${RUN_ID}`,
      ]),
      expect.arrayContaining([
        'volume', 'inspect',
        `cecelia-codex-review-egress-${RUN_ID}`,
      ]),
      expect.arrayContaining([
        'run', '--rm', '--network', 'none', '--user', '0:0',
        '--mount',
        `type=volume,src=cecelia-codex-review-egress-${RUN_ID},dst=/broker`,
        IMAGE_ID,
      ]),
      expect.arrayContaining([
        'run', '--detach',
        '--name', `cecelia-codex-review-broker-${RUN_ID}`,
        '--label', 'cecelia.kind=codex-review-broker',
        '--label', `cecelia.run_id=${RUN_ID}`,
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--user', '1001:1001',
        '--network', 'bridge',
        '--mount',
        `type=volume,src=cecelia-codex-review-egress-${RUN_ID},dst=/broker`,
        '--entrypoint', '/usr/local/bin/node',
        IMAGE_ID,
        '/app/src/lib/codex-review-egress-broker.js',
        '/broker/proxy.sock',
      ]),
      expect.arrayContaining([
        'exec',
        `cecelia-codex-review-broker-${RUN_ID}`,
        '/usr/local/bin/node',
      ]),
    ]);
    const flattened = JSON.stringify(execute.mock.calls);
    expect(flattened).not.toMatch(
      /auth\.json|review-source-git|workspace|docker\.sock|DB_PASSWORD|DEPLOY_TOKEN/,
    );
  });

  it('fails closed and removes both broker and volume when readiness never succeeds', async () => {
    const execute = vi.fn(async (_bin, args) => {
      if (args[0] === 'volume' && args[1] === 'inspect') {
        return volumeInspect();
      }
      if (args[0] === 'inspect' && args.includes(
        `cecelia-codex-review-broker-${RUN_ID}`,
      )) {
        return containerInspect('codex-review-broker');
      }
      if (args[0] === 'exec') throw new Error('not ready');
      return '';
    });

    await expect(startCodexReviewEgress({
      dockerBin: '/usr/bin/docker',
      imageId: IMAGE_ID,
      runId: RUN_ID,
      execute,
      wait: vi.fn(async () => {}),
      readinessAttempts: 2,
      now: () => NOW,
      ownerNonce: OWNER_NONCE,
    })).rejects.toThrow('review_egress_broker_not_ready');

    expect(execute).toHaveBeenCalledWith(
      '/usr/bin/docker',
      ['rm', '--force', `cecelia-codex-review-broker-${RUN_ID}`],
      expect.any(Object),
    );
    expect(execute).toHaveBeenCalledWith(
      '/usr/bin/docker',
      ['volume', 'rm', '--force', `cecelia-codex-review-egress-${RUN_ID}`],
      expect.any(Object),
    );
  });

  it('dispose is idempotent and removes the sidecar before its socket volume', async () => {
    const execute = vi.fn(async (_bin, args) => {
      if (args[0] === 'volume' && args[1] === 'inspect') {
        return volumeInspect();
      }
      if (args[0] === 'inspect' && args.includes(
        `cecelia-codex-review-broker-${RUN_ID}`,
      )) {
        return containerInspect('codex-review-broker');
      }
      return '';
    });
    const runtime = await startCodexReviewEgress({
      dockerBin: '/usr/bin/docker',
      imageId: IMAGE_ID,
      runId: RUN_ID,
      execute,
      wait: vi.fn(async () => {}),
      now: () => NOW,
      ownerNonce: OWNER_NONCE,
    });
    execute.mockClear();

    await runtime.dispose();
    await runtime.dispose();

    expect(execute.mock.calls.map(([, args]) => args)).toEqual([
      [
        'inspect', '--format', '{{json .}}',
        `cecelia-codex-review-broker-${RUN_ID}`,
      ],
      [
        'volume', 'inspect', '--format', '{{json .}}',
        `cecelia-codex-review-egress-${RUN_ID}`,
      ],
      ['rm', '--force', `cecelia-codex-review-broker-${RUN_ID}`],
      ['volume', 'rm', '--force', `cecelia-codex-review-egress-${RUN_ID}`],
      expect.arrayContaining(['ps', '-a']),
      expect.arrayContaining(['volume', 'ls']),
    ]);
  });

  it('tears down reviewer then broker then volume and surfaces cleanup failure for retry', async () => {
    const names = buildCodexReviewEgressNames(RUN_ID);
    const reviewerContainerName = `cecelia-codex-review-${RUN_ID}`;
    const execute = vi.fn(async (_bin, args) => {
      if (args[0] === 'inspect' && args.includes(reviewerContainerName)) {
        return containerInspect('codex-reviewer');
      }
      if (args[0] === 'inspect' && args.includes(names.brokerContainerName)) {
        return containerInspect('codex-review-broker');
      }
      if (args[0] === 'volume' && args[1] === 'inspect') {
        return volumeInspect();
      }
      if (args[0] === 'volume' && args[1] === 'rm') {
        throw Object.assign(new Error('volume is in use'), {
          stderr: 'volume is in use',
        });
      }
      return '';
    });

    await expect(cleanupCodexReviewEgress({
      dockerBin: '/usr/bin/docker',
      reviewerContainerName,
      ...names,
      ownerNonce: OWNER_NONCE,
      execute,
    })).rejects.toThrow('review_egress_cleanup_failed');

    expect(execute.mock.calls.map(([, args]) => args)).toEqual([
      ['inspect', '--format', '{{json .}}', reviewerContainerName],
      ['inspect', '--format', '{{json .}}', names.brokerContainerName],
      [
        'volume', 'inspect', '--format', '{{json .}}',
        names.egressVolumeName,
      ],
      ['rm', '--force', reviewerContainerName],
      ['rm', '--force', names.brokerContainerName],
      ['volume', 'rm', '--force', names.egressVolumeName],
    ]);
  });

  it('refuses cleanup when any resource owner nonce does not match', async () => {
    const names = buildCodexReviewEgressNames(RUN_ID);
    const reviewerContainerName = `cecelia-codex-review-${RUN_ID}`;
    const execute = vi.fn(async (_bin, args) => {
      if (args[0] === 'inspect' && args.includes(reviewerContainerName)) {
        return JSON.stringify({
          Config: {
            Labels: {
              'cecelia.kind': 'codex-reviewer',
              'cecelia.run_id': RUN_ID,
              'cecelia.owner_nonce': OWNER_NONCE,
            },
          },
        });
      }
      if (args[0] === 'inspect' && args.includes(names.brokerContainerName)) {
        return JSON.stringify({
          Config: {
            Labels: {
              'cecelia.kind': 'codex-review-broker',
              'cecelia.run_id': RUN_ID,
              'cecelia.owner_nonce': 'e'.repeat(32),
            },
          },
        });
      }
      if (args[0] === 'volume' && args[1] === 'inspect') {
        return volumeInspect();
      }
      return '';
    });

    await expect(cleanupCodexReviewEgress({
      dockerBin: '/usr/bin/docker',
      reviewerContainerName,
      ...names,
      ownerNonce: OWNER_NONCE,
      execute,
    })).rejects.toThrow('review_egress_cleanup_identity_mismatch');

    expect(execute.mock.calls.some(([, args]) => (
      args[0] === 'rm' || (args[0] === 'volume' && args[1] === 'rm')
    ))).toBe(false);
  });

  it('treats verified-missing owned resources as already cleaned', async () => {
    const names = buildCodexReviewEgressNames(RUN_ID);
    const reviewerContainerName = `cecelia-codex-review-${RUN_ID}`;
    const execute = vi.fn(async (_bin, args) => {
      if (args[0] === 'inspect') {
        throw Object.assign(new Error('No such object'), {
          stderr: 'Error: No such container',
        });
      }
      if (args[0] === 'volume' && args[1] === 'inspect') {
        throw Object.assign(new Error('No such volume'), {
          stderr: 'Error: No such volume',
        });
      }
      return '';
    });

    await expect(cleanupCodexReviewEgress({
      dockerBin: '/usr/bin/docker',
      reviewerContainerName,
      ...names,
      ownerNonce: OWNER_NONCE,
      execute,
    })).resolves.toBeUndefined();

    expect(execute.mock.calls.some(([, args]) => (
      args[0] === 'rm' || (args[0] === 'volume' && args[1] === 'rm')
    ))).toBe(false);
  });

  it('fails closed on unknown identity inspection errors', async () => {
    const names = buildCodexReviewEgressNames(RUN_ID);
    const execute = vi.fn(async (_bin, args) => {
      if (args[0] === 'inspect') {
        throw new Error('docker daemon unavailable');
      }
      if (args[0] === 'volume' && args[1] === 'inspect') {
        return volumeInspect();
      }
      return '';
    });

    await expect(cleanupCodexReviewEgress({
      dockerBin: '/usr/bin/docker',
      ...names,
      ownerNonce: OWNER_NONCE,
      execute,
    })).rejects.toThrow('review_egress_cleanup_identity_unknown');

    expect(execute.mock.calls.some(([, args]) => (
      args[0] === 'rm' || (args[0] === 'volume' && args[1] === 'rm')
    ))).toBe(false);
  });

  it('never deletes a pre-existing volume after owner identity conflict', async () => {
    const names = buildCodexReviewEgressNames(RUN_ID);
    const execute = vi.fn(async (_bin, args) => {
      if (args[0] === 'volume' && args[1] === 'inspect') {
        return JSON.stringify({
          Name: names.egressVolumeName,
          Labels: {
            'cecelia.kind': 'codex-review-egress',
            'cecelia.run_id': RUN_ID,
            'cecelia.owner_nonce': 'e'.repeat(32),
            'cecelia.expires_at': EXPIRES_AT,
          },
        });
      }
      return '';
    });

    await expect(startCodexReviewEgress({
      dockerBin: '/usr/bin/docker',
      imageId: IMAGE_ID,
      runId: RUN_ID,
      execute,
      wait: vi.fn(async () => {}),
      now: () => NOW,
      ownerNonce: OWNER_NONCE,
    })).rejects.toThrow('review_egress_broker_start_failed');

    expect(execute).not.toHaveBeenCalledWith(
      '/usr/bin/docker',
      ['volume', 'rm', '--force', names.egressVolumeName],
      expect.any(Object),
    );
  });

  it('reaps expired labeled runtimes without relying on slot metadata', async () => {
    const names = buildCodexReviewEgressNames(RUN_ID);
    const reviewerContainerName = `cecelia-codex-review-${RUN_ID}`;
    const execute = vi.fn(async (_bin, args) => {
      if (args[0] === 'ps' && args.includes('label=cecelia.expires_at')) {
        return `${names.brokerContainerName}\n${reviewerContainerName}\n`;
      }
      if (args[0] === 'volume' && args[1] === 'ls' && args.includes(
        'label=cecelia.expires_at',
      )) {
        return `${names.egressVolumeName}\n`;
      }
      if (args[0] === 'inspect' && args.includes(names.brokerContainerName)) {
        return containerInspect(
          'codex-review-broker',
          OWNER_NONCE,
          '2020-01-01T00:00:00.000Z',
        );
      }
      if (args[0] === 'inspect' && args.includes(reviewerContainerName)) {
        return containerInspect(
          'codex-reviewer',
          OWNER_NONCE,
          '2020-01-01T00:00:00.000Z',
        );
      }
      if (args[0] === 'volume' && args[1] === 'inspect') {
        return JSON.stringify({
          Name: names.egressVolumeName,
          Labels: {
            'cecelia.kind': 'codex-review-egress',
            'cecelia.run_id': RUN_ID,
            'cecelia.owner_nonce': OWNER_NONCE,
            'cecelia.expires_at': '2020-01-01T00:00:00.000Z',
          },
        });
      }
      return '';
    });

    const result = await reapExpiredCodexReviewEgress({
      dockerBin: '/usr/bin/docker',
      execute,
      now: () => new Date('2020-01-01T00:01:00.000Z'),
    });

    expect(result).toEqual({ scanned: 1, reaped: 1, pending: 0 });
    expect(execute.mock.calls.map(([, args]) => args)).toEqual(
      expect.arrayContaining([
        ['rm', '--force', reviewerContainerName],
        ['rm', '--force', names.brokerContainerName],
        ['volume', 'rm', '--force', names.egressVolumeName],
      ]),
    );
  });

  it('runs the TTL reaper immediately, periodically, and once forced at shutdown', async () => {
    const reap = vi.fn(async () => ({
      scanned: 0,
      reaped: 0,
      pending: 0,
    }));
    const timer = { unref: vi.fn() };
    const schedule = vi.fn(() => timer);
    const cancel = vi.fn();
    const controller = startCodexReviewEgressReaper({
      dockerBin: '/usr/bin/docker',
      reap,
      schedule,
      cancel,
      intervalMs: 60_000,
    });
    await vi.waitFor(() => expect(reap).toHaveBeenCalledTimes(1));
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(timer.unref).toHaveBeenCalled();

    await controller.stop({ cleanupActive: true });

    expect(cancel).toHaveBeenCalledWith(timer);
    expect(reap).toHaveBeenLastCalledWith({
      dockerBin: '/usr/bin/docker',
      force: true,
    });
  });
});
