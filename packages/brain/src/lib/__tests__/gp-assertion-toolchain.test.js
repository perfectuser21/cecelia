import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { assertionCommand } from '../gp-assertion-command.js';
import {
  createToolchainAttestation,
  verifyToolchainAttestation,
} from '../gp-assertion-toolchain.js';

const RUNNER_DIGEST = `sha256:${'a'.repeat(64)}`;
const OTHER_DIGEST = `sha256:${'b'.repeat(64)}`;
const BASE = new Map([
  ['/tools/node', 'node-binary-secret-bytes'],
  ['/tools/vitest.mjs', 'vitest-binary-secret-bytes'],
]);
const COMMAND = await assertionCommand('packages/brain/src/example.test.js', '/repo', {
  realpathFn: vi.fn(async path => path),
  fileStatFn: vi.fn(async () => ({ isFile: () => true })),
  pathExistsFn: vi.fn(async path => path === '/repo/packages/brain/package.json'),
  isTrackedPathFn: vi.fn(async () => true),
  toolchains: Object.fromEntries([...BASE].map(([path, bytes], index) => [
    index ? 'vitest' : 'node',
    { path, sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` },
  ])),
});

function validInput(overrides = {}) {
  return {
    actual_runner_digest: RUNNER_DIGEST,
    expected_runner_digest: RUNNER_DIGEST,
    command: COMMAND,
    ...overrides,
  };
}

function fakeFileSystem(contents) {
  const openFn = vi.fn(async path => {
    const bytes = Buffer.from(contents.get(path) ?? BASE.get(path));
    const stats = {
      dev: 1n, ino: 2n, size: BigInt(bytes.length), ctimeNs: 3n, mtimeNs: 4n,
      isFile: () => true,
    };
    return {
      stat: vi.fn(async () => stats),
      read: vi.fn(async (buffer, offset, length, position) => {
        const count = Math.min(length, Math.max(0, bytes.length - position));
        bytes.copy(buffer, offset, position, position + count);
        return { bytesRead: count };
      }),
      close: vi.fn(async () => {}),
    };
  });
  return {
    openFn,
  };
}

describe('GP assertion pinned toolchain attestation', () => {
  it.each([
    [
      { actual_runner_digest: undefined },
      'ASSERTION_RUNNER_DIGEST_REQUIRED',
    ],
    [
      { expected_runner_digest: undefined },
      'ASSERTION_RUNNER_DIGEST_REQUIRED',
    ],
    [
      { actual_runner_digest: 'sha256:not-a-digest' },
      'ASSERTION_RUNNER_DIGEST_INVALID',
    ],
    [
      { expected_runner_digest: 'A'.repeat(64) },
      'ASSERTION_RUNNER_DIGEST_INVALID',
    ],
    [
      { expected_runner_digest: OTHER_DIGEST },
      'ASSERTION_RUNNER_DIGEST_MISMATCH',
    ],
  ])('fails closed for invalid pinned runner input %#', async (override, code) => {
    await expect(createToolchainAttestation(
      validInput(override),
      fakeFileSystem(new Map()),
    )).rejects.toMatchObject({ code });
  });

  it('does not accept legacy caller-provided toolchain paths', async () => {
    await expect(createToolchainAttestation(
      { ...validInput(), command: undefined, toolchain_paths: ['/tools/node'] },
      fakeFileSystem(new Map()),
    )).rejects.toMatchObject({ code: 'ASSERTION_COMMAND_UNTRUSTED' });
  });

  it('requires native strings for runner digests', async () => {
    const digest = { toString: () => RUNNER_DIGEST };
    await expect(createToolchainAttestation(
      validInput({ actual_runner_digest: digest, expected_runner_digest: digest }),
      fakeFileSystem(new Map()),
    )).rejects.toMatchObject({ code: 'ASSERTION_RUNNER_DIGEST_INVALID' });
  });

  it('deep-freezes the trusted pre-execution baseline', async () => {
    const attestation = await createToolchainAttestation(
      validInput(), fakeFileSystem(new Map()),
    );
    expect([attestation, attestation.files, ...attestation.files]
      .every(Object.isFrozen)).toBe(true);
  });

  it('rejects a structurally valid self-issued baseline', async () => {
    const fs = fakeFileSystem(new Map());
    const attestation = await createToolchainAttestation(validInput(), fs);
    await expect(verifyToolchainAttestation(
      structuredClone(attestation), fs,
    )).rejects.toMatchObject({ code: 'ASSERTION_TOOLCHAIN_ATTESTATION_UNTRUSTED' });
  });

  it.each([
    value => ({ ...value, credential: 'credential-secret' }),
    value => ({
      ...value,
      files: value.files.map(file => ({ ...file, content: 'binary-secret' })),
    }),
  ])('rejects non-minimal attestation schema without leaking it', async forge => {
    const fs = fakeFileSystem(new Map());
    const attestation = await createToolchainAttestation(validInput(), fs);
    const error = await verifyToolchainAttestation(forge(attestation), fs)
      .catch(reason => reason);
    expect(error).toMatchObject({ code: 'ASSERTION_TOOLCHAIN_ATTESTATION_UNTRUSTED' });
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  it('normalizes creation filesystem errors', async () => {
    const leak = Object.assign(new Error('credential-secret'), {
      credential: 'credential-secret',
    });
    const error = await createToolchainAttestation(validInput(), {
      openFn: vi.fn(async () => { throw leak; }),
    }).catch(reason => reason);
    expect(error).toMatchObject({ code: 'ASSERTION_TOOLCHAIN_UNAVAILABLE' });
    expect(JSON.stringify(error)).not.toContain('credential-secret');
  });

  it('normalizes verification filesystem errors without retaining causes', async () => {
    const fs = fakeFileSystem(new Map());
    const attestation = await createToolchainAttestation(validInput(), fs);
    const leak = Object.assign(new Error('credential-secret'), {
      credential: 'credential-secret',
    });
    const error = await verifyToolchainAttestation(attestation, {
      openFn: vi.fn(async () => { throw leak; }),
    }).catch(reason => reason);
    expect(error).toMatchObject({ code: 'ASSERTION_TOOLCHAIN_DRIFT' });
    expect(JSON.stringify(error)).not.toContain('credential-secret');
  });

  it('realpaths and hashes every file without retaining its content', async () => {
    const contents = new Map([
      ...BASE,
    ]);
    const fs = fakeFileSystem(contents);

    const attestation = await createToolchainAttestation(validInput(), fs);

    expect(fs.openFn.mock.calls.map(call => call.slice(0, 1))).toEqual([
      ['/tools/node'],
      ['/tools/vitest.mjs'],
    ]);
    expect(attestation).toEqual({
      kind: 'pinned_toolchain',
      actual_runner_digest: RUNNER_DIGEST,
      expected_runner_digest: RUNNER_DIGEST,
      files: [
        {
          path: '/tools/node',
          sha256: `sha256:${createHash('sha256')
            .update(contents.get('/tools/node')).digest('hex')}`,
        },
        {
          path: '/tools/vitest.mjs',
          sha256: `sha256:${createHash('sha256')
            .update(contents.get('/tools/vitest.mjs')).digest('hex')}`,
        },
      ],
    });
    const scenarioEvidence = JSON.stringify({
      kind: 'vitest',
      toolchain_attestation: attestation,
    });
    expect(JSON.parse(scenarioEvidence).toolchain_attestation).toEqual(
      attestation,
    );
    expect(scenarioEvidence).not.toContain('binary-secret-bytes');
  });

  it('revalidates unchanged files and rejects post-execution drift', async () => {
    const contents = new Map([
      ...BASE,
    ]);
    const fs = fakeFileSystem(contents);
    const attestation = await createToolchainAttestation(validInput(), fs);

    await expect(
      verifyToolchainAttestation(attestation, fs),
    ).resolves.toEqual(attestation);

    contents.set('/tools/vitest.mjs', 'git-v2');
    await expect(
      verifyToolchainAttestation(attestation, fs),
    ).rejects.toMatchObject({
      code: 'ASSERTION_TOOLCHAIN_DRIFT',
      path: '/tools/vitest.mjs',
    });
  });
});
