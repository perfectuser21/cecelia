import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createToolchainAttestation,
  verifyToolchainAttestation,
} from '../gp-assertion-toolchain.js';

const RUNNER_DIGEST = `sha256:${'a'.repeat(64)}`;
const OTHER_DIGEST = `sha256:${'b'.repeat(64)}`;

function validInput(overrides = {}) {
  return {
    actual_runner_digest: RUNNER_DIGEST,
    expected_runner_digest: RUNNER_DIGEST,
    toolchain_paths: ['/tools/node', '/tools/git'],
    ...overrides,
  };
}

function fakeFileSystem(contents) {
  const handles = [];
  const fs = {
    realpathFn: vi.fn(async path => path.replace('/tools/', '/real/')),
    openFn: vi.fn(async path => {
      const bytes = Buffer.from(contents.get(path));
      let sent = false;
      const handle = {
        stat: vi.fn(async () => ({ isFile: () => true, size: bytes.length })),
        read: vi.fn(async buffer => {
          if (sent) return { bytesRead: 0 };
          sent = true;
          bytes.copy(buffer);
          return { bytesRead: bytes.length };
        }),
        close: vi.fn(),
      };
      handles.push(handle);
      return handle;
    }),
    handles,
  };
  return fs;
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

  it.each([
    [[], 'ASSERTION_TOOLCHAIN_PATHS_REQUIRED'],
    [['relative/node'], 'ASSERTION_TOOLCHAIN_PATH_INVALID'],
    [[undefined], 'ASSERTION_TOOLCHAIN_PATH_INVALID'],
  ])('rejects invalid toolchain paths %#', async (toolchainPaths, code) => {
    await expect(createToolchainAttestation(
      validInput({ toolchain_paths: toolchainPaths }),
      fakeFileSystem(new Map()),
    )).rejects.toMatchObject({ code });
  });

  it('realpaths and hashes every file without retaining its content', async () => {
    const contents = new Map([
      ['/real/node', 'node-binary-secret-bytes'],
      ['/real/git', 'git-binary-secret-bytes'],
    ]);
    const fs = fakeFileSystem(contents);

    const attestation = await createToolchainAttestation(validInput(), fs);

    expect(fs.realpathFn.mock.calls).toEqual([
      ['/tools/node'],
      ['/tools/git'],
    ]);
    expect(fs.handles.every(handle => (
      handle.stat.mock.calls.length === 1
      && handle.read.mock.calls.length >= 1
      && handle.close.mock.calls.length === 1
    ))).toBe(true);
    expect(attestation).toEqual({
      kind: 'pinned_toolchain',
      actual_runner_digest: RUNNER_DIGEST,
      expected_runner_digest: RUNNER_DIGEST,
      files: [
        {
          path: '/real/node',
          sha256: `sha256:${createHash('sha256')
            .update(contents.get('/real/node')).digest('hex')}`,
        },
        {
          path: '/real/git',
          sha256: `sha256:${createHash('sha256')
            .update(contents.get('/real/git')).digest('hex')}`,
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

  it.each([
    [false, 1, 10, 'ASSERTION_TOOLCHAIN_FILE_NOT_REGULAR'],
    [true, 0, 10, 'ASSERTION_TOOLCHAIN_FILE_EMPTY'],
    [true, 5, 4, 'ASSERTION_TOOLCHAIN_FILE_TOO_LARGE'],
  ])('rejects unsafe file metadata %#', async (regular, size, limit, code) => {
    const handle = {
      stat: vi.fn(async () => ({ isFile: () => regular, size })),
      read: vi.fn(),
      close: vi.fn(),
    };
    await expect(createToolchainAttestation(validInput({
      toolchain_paths: ['/tools/node'],
    }), {
      realpathFn: vi.fn(async path => path),
      openFn: vi.fn(async () => handle),
      maxFileBytes: limit,
    })).rejects.toMatchObject({ code });
    expect(handle.read).not.toHaveBeenCalled();
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it('revalidates unchanged files and rejects post-execution drift', async () => {
    const contents = new Map([
      ['/real/node', 'node-v1'],
      ['/real/git', 'git-v1'],
    ]);
    const fs = fakeFileSystem(contents);
    const attestation = await createToolchainAttestation(validInput(), fs);

    await expect(
      verifyToolchainAttestation(attestation, fs),
    ).resolves.toEqual(attestation);

    contents.set('/real/git', 'git-v2');
    await expect(
      verifyToolchainAttestation(attestation, fs),
    ).rejects.toMatchObject({
      code: 'ASSERTION_TOOLCHAIN_DRIFT',
      path: '/real/git',
    });
  });
});
