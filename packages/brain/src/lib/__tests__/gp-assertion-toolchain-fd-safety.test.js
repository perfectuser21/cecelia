import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { assertionCommand } from '../gp-assertion-command.js';
import { createToolchainAttestation, verifyToolchainAttestation } from '../gp-assertion-toolchain.js';
const RUNNER = `sha256:${'a'.repeat(64)}`;
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
async function commandFor(bytes, sha256 = digest(bytes)) {
  return assertionCommand('scripts/smoke/gp.sh', '/repo', {
    realpathFn: vi.fn(async path => path),
    fileStatFn: vi.fn(async () => ({ isFile: () => true })),
    isTrackedPathFn: vi.fn(async () => true),
    toolchains: { bash: { path: '/tools/bash',
      ...(sha256 === null ? {} : { sha256 }) } },
  });
}
function fileSystem(bytes, {
  size = BigInt(bytes.length), regular = true, maxRead = 64 * 1024,
} = {}) {
  const metadata = { dev: 1n, ino: 2n, size, ctimeNs: 3n, mtimeNs: 4n,
    isFile: () => regular };
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
const input = command => ({ command, actual_runner_digest: RUNNER, expected_runner_digest: RUNNER });
const secretError = () => Object.assign(new Error('credential-secret'), { credential: 'credential-secret' });
describe('GP assertion same-FD toolchain safety', () => {
  it('accepts only the original branded assertion command', async () => {
    const bytes = Buffer.from('tool-v1');
    const command = await commandFor(bytes);
    const fs = fileSystem(bytes);
    for (const forged of [structuredClone(command), Object.freeze({ ...command })]) {
      await expect(createToolchainAttestation(input(forged), fs))
        .rejects.toMatchObject({ code: 'ASSERTION_COMMAND_UNTRUSTED' });
    }
  });
  it('opens the canonical tool with no-follow flags and hashes one FD', async () => {
    const bytes = Buffer.from('tool-v1');
    const command = await commandFor(bytes);
    const fs = fileSystem(bytes);
    await expect(createToolchainAttestation(input(command), fs)).resolves
      .toMatchObject({ files: [{ path: '/tools/bash', sha256: digest(bytes) }] });
    expect(fs.openFn).toHaveBeenCalledWith('/tools/bash', constants.O_RDONLY
      | constants.O_NONBLOCK | constants.O_NOFOLLOW);
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
    await expect(createToolchainAttestation(input(command),
      { ...fs, maxFileBytes: 4 })).rejects.toMatchObject({ code });
    expect(fs.handle.close).toHaveBeenCalledOnce();
  });
  it('hashes a greater-than-64KiB file across bounded short reads', async () => {
    const bytes = Buffer.alloc(70 * 1024, 7);
    const command = await commandFor(bytes);
    const fs = fileSystem(bytes, { maxRead: 9973 });
    const result = await createToolchainAttestation(input(command),
      { ...fs, maxFileBytes: bytes.length });
    expect(result.files[0].sha256).toBe(digest(bytes));
    expect(fs.handle.read.mock.calls.every(call => call[2] <= 64 * 1024)).toBe(true);
    expect(fs.handle.read.mock.calls.map(call => call[3])[0]).toBe(0);
    expect(fs.handle.read.mock.calls.length).toBeGreaterThan(1);
  });
  it.each([
    [null, Buffer.from('tool'), 'ASSERTION_TOOLCHAIN_DIGEST_INVALID'],
    [digest(Buffer.from('expected')), Buffer.from('actual'),
      'ASSERTION_TOOLCHAIN_DIGEST_MISMATCH'],
  ])('requires and matches each command tool digest %#', async (sha256, bytes, code) => {
    const command = await commandFor(bytes, sha256);
    await expect(createToolchainAttestation(input(command), fileSystem(bytes)))
      .rejects.toMatchObject({ code });
  });
  it.each([
    ['early EOF', Buffer.from('tool'), { size: 5n }, 'ASSERTION_TOOLCHAIN_UNAVAILABLE'],
    ['extra byte', Buffer.from('tool'), { size: 3n }, 'ASSERTION_TOOLCHAIN_CHANGED_DURING_READ'],
  ])('rejects %s from the opened snapshot', async (_name, bytes, options, code) => {
    const command = await commandFor(bytes);
    await expect(createToolchainAttestation(input(command), fileSystem(bytes, options)))
      .rejects.toMatchObject({ code });
  });
  it('rejects same-FD metadata changes', async () => {
    const bytes = Buffer.from('tool');
    const command = await commandFor(bytes);
    const fs = fileSystem(bytes);
    fs.handle.stat.mockResolvedValueOnce(await fs.handle.stat())
      .mockResolvedValueOnce({ ...await fs.handle.stat(), mtimeNs: 99n });
    await expect(createToolchainAttestation(input(command), fs))
      .rejects.toMatchObject({ code: 'ASSERTION_TOOLCHAIN_CHANGED_DURING_READ' });
  });
  it('normalizes invalid bytesRead without retaining data', async () => {
    const bytes = Buffer.from('tool');
    const fs = fileSystem(bytes);
    fs.handle.read.mockResolvedValueOnce({ bytesRead: 1.5 });
    const error = await createToolchainAttestation(
      input(await commandFor(bytes)), fs).catch(reason => reason);
    expect(error).toMatchObject({ code: 'ASSERTION_TOOLCHAIN_UNAVAILABLE' });
    expect(JSON.stringify(error)).not.toContain('credential-secret');
  });
  it('normalizes close failures and preserves a primary safety error', async () => {
    const bytes = Buffer.from('tool');
    const command = await commandFor(bytes);
    const createFs = fileSystem(bytes);
    createFs.handle.close.mockRejectedValue(secretError());
    const createError = await createToolchainAttestation(input(command), createFs)
      .catch(reason => reason);
    expect(createError).toMatchObject({ code: 'ASSERTION_TOOLCHAIN_UNAVAILABLE' });
    expect(JSON.stringify(createError)).not.toContain('credential-secret');
    const attestation = await createToolchainAttestation(input(command), fileSystem(bytes));
    const verifyFs = fileSystem(bytes);
    verifyFs.handle.close.mockRejectedValue(secretError());
    const verifyError = await verifyToolchainAttestation(attestation, verifyFs)
      .catch(reason => reason);
    expect(verifyError).toMatchObject({ code: 'ASSERTION_TOOLCHAIN_DRIFT' });
    expect(JSON.stringify(verifyError)).not.toContain('credential-secret');
    const primaryFs = fileSystem(Buffer.alloc(0));
    primaryFs.handle.close.mockRejectedValue(secretError());
    await expect(createToolchainAttestation(
      input(await commandFor(Buffer.from('expected'))), primaryFs))
      .rejects.toMatchObject({ code: 'ASSERTION_TOOLCHAIN_FILE_EMPTY' });
  });
});
