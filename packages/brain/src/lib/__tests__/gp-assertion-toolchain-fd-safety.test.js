import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { assertionCommand } from '../gp-assertion-command.js';
import { createToolchainAttestation } from '../gp-assertion-toolchain.js';

const RUNNER = `sha256:${'a'.repeat(64)}`;
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function commandFor(bytes) {
  return assertionCommand('scripts/smoke/gp.sh', '/repo', {
    realpathFn: vi.fn(async path => path),
    fileStatFn: vi.fn(async () => ({ isFile: () => true })),
    isTrackedPathFn: vi.fn(async () => true),
    toolchains: { bash: { path: '/tools/bash', sha256: digest(bytes) } },
  });
}

function fileSystem(bytes, {
  size = BigInt(bytes.length), regular = true, maxRead = 64 * 1024,
} = {}) {
  const metadata = {
    dev: 1n, ino: 2n, size, ctimeNs: 3n, mtimeNs: 4n,
    isFile: () => regular,
  };
  const handle = {
    stat: vi.fn(async () => metadata),
    read: vi.fn(async (buffer, offset, length, position) => {
      const count = Math.min(length, maxRead, Math.max(0, bytes.length - position));
      bytes.copy(buffer, offset, position, position + count);
      return { bytesRead: count };
    }),
    close: vi.fn(async () => {}),
  };
  return { handle, openFn: vi.fn(async () => handle) };
}

const input = command => ({
  command,
  actual_runner_digest: RUNNER,
  expected_runner_digest: RUNNER,
});

describe('GP assertion same-FD toolchain safety', () => {
  it('accepts only the original branded assertion command', async () => {
    const bytes = Buffer.from('tool-v1');
    const command = await commandFor(bytes);
    const fs = fileSystem(bytes);
    await expect(createToolchainAttestation(
      input(structuredClone(command)), fs,
    )).rejects.toMatchObject({ code: 'ASSERTION_COMMAND_UNTRUSTED' });
    await expect(createToolchainAttestation(
      input(Object.freeze({ ...command })), fs,
    )).rejects.toMatchObject({ code: 'ASSERTION_COMMAND_UNTRUSTED' });
  });

  it('opens the canonical tool with no-follow flags and hashes one FD', async () => {
    const bytes = Buffer.from('tool-v1');
    const command = await commandFor(bytes);
    const fs = fileSystem(bytes);
    await expect(createToolchainAttestation(input(command), fs)).resolves
      .toMatchObject({ files: [{ path: '/tools/bash', sha256: digest(bytes) }] });
    expect(fs.openFn).toHaveBeenCalledWith('/tools/bash',
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    expect(fs.handle.stat).toHaveBeenCalledTimes(2);
    expect(fs.handle.stat).toHaveBeenCalledWith({ bigint: true });
    expect(fs.handle.close).toHaveBeenCalledOnce();
  });

  it.each([
    [Buffer.alloc(0), {}, 'ASSERTION_TOOLCHAIN_FILE_EMPTY'],
    [Buffer.from('tool'), { regular: false }, 'ASSERTION_TOOLCHAIN_FILE_NOT_REGULAR'],
    [Buffer.from('tool'), { size: 5n }, 'ASSERTION_TOOLCHAIN_FILE_TOO_LARGE'],
  ])('rejects unsafe file metadata %#', async (bytes, options, code) => {
    const command = await commandFor(bytes.length ? bytes : Buffer.from('expected'));
    const fs = fileSystem(bytes, options);
    await expect(createToolchainAttestation(
      input(command), { ...fs, maxFileBytes: 4 },
    )).rejects.toMatchObject({ code });
    expect(fs.handle.close).toHaveBeenCalledOnce();
  });

  it('hashes a greater-than-64KiB file across bounded short reads', async () => {
    const bytes = Buffer.alloc(70 * 1024, 7);
    const command = await commandFor(bytes);
    const fs = fileSystem(bytes, { maxRead: 9973 });
    const result = await createToolchainAttestation(
      input(command), { ...fs, maxFileBytes: bytes.length },
    );
    expect(result.files[0].sha256).toBe(digest(bytes));
    expect(fs.handle.read.mock.calls.every(call => call[2] <= 64 * 1024)).toBe(true);
    expect(fs.handle.read.mock.calls.map(call => call[3])[0]).toBe(0);
    expect(fs.handle.read.mock.calls.length).toBeGreaterThan(1);
  });
});
