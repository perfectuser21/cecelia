import { describe, expect, it, vi } from 'vitest';
import {
  defaultRun,
  main,
  parseArgs,
} from './run-gp-assertion.mjs';

const LINK = '22222222-2222-4222-8222-222222222222';
const RUN = '11111111-1111-4111-8111-111111111111';
const unavailable = () => Object.assign(
  new Error('ASSERTION_TRUSTED_RUNNER_UNAVAILABLE'),
  { code: 'ASSERTION_TRUSTED_RUNNER_UNAVAILABLE' },
);

function io(run = vi.fn().mockRejectedValue(unavailable())) {
  return {
    run,
    randomId: vi.fn(() => RUN),
    writeStdout: vi.fn(),
    writeStderr: vi.fn(),
  };
}

describe('run-gp-assertion fail-closed CLI', () => {
  it('accepts only link and optional run identifiers', () => {
    expect(parseArgs(['--link-id', LINK])).toEqual({ linkId: LINK });
    expect(parseArgs([
      '--run-id', RUN, '--link-id', LINK,
    ])).toEqual({ linkId: LINK, runId: RUN });
  });

  it.each([
    [[], '--link-id'],
    [['--link-id'], 'requires'],
    [['--link-id', LINK, '--link-id', LINK], 'once'],
    [['--link-id', LINK, '--verdict', 'PASS'], '--verdict'],
    [['--link-id', LINK, '--execute', '/bin/bash'], 'Unsupported'],
    [['--link-id', LINK, '--trusted-execute', 'fake'], 'Unsupported'],
  ])('rejects unsafe arguments %#', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  it('uses the real runner default and closes an unopened pool', async () => {
    const pool = { connect: vi.fn(), end: vi.fn().mockResolvedValue() };
    await expect(defaultRun({ linkId: LINK, runId: RUN }, {
      resolveRoot: vi.fn().mockResolvedValue('/repo'),
      loadPool: vi.fn().mockResolvedValue(pool),
    })).rejects.toMatchObject({
      code: 'ASSERTION_TRUSTED_RUNNER_UNAVAILABLE',
    });
    expect(pool.connect).not.toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('never forwards legacy execution dependencies', async () => {
    const pool = { end: vi.fn().mockResolvedValue() };
    const runAssertion = vi.fn().mockRejectedValue(unavailable());
    const legacy = vi.fn();
    await defaultRun({ linkId: LINK, runId: RUN }, {
      resolveRoot: vi.fn().mockResolvedValue('/repo'),
      loadPool: vi.fn().mockResolvedValue(pool),
      runAssertion,
      execute: legacy,
      trustedExecute: legacy,
    }).catch(() => {});
    expect(runAssertion).toHaveBeenCalledWith({
      pool, linkId: LINK, runId: RUN, repoRoot: '/repo',
    });
    expect(legacy).not.toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('returns argument errors without invoking the runner', async () => {
    const subject = io();
    await expect(main({
      argv: ['--link-id', LINK, '--verdict', 'PASS'],
      ...subject,
    })).resolves.toBe(2);
    expect(subject.run).not.toHaveBeenCalled();
    expect(JSON.parse(subject.writeStderr.mock.calls[0][0])).toMatchObject({
      error: 'INVALID_ARGUMENTS',
    });
  });

  it('emits the real unavailable code as one stderr JSON line', async () => {
    const subject = io();
    await expect(main({
      argv: ['--link-id', LINK, '--run-id', RUN],
      ...subject,
    })).resolves.toBe(1);
    expect(subject.writeStdout).not.toHaveBeenCalled();
    expect(subject.writeStderr).toHaveBeenCalledOnce();
    const line = subject.writeStderr.mock.calls[0][0];
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(line)).toMatchObject({
      error: 'ASSERTION_TRUSTED_RUNNER_UNAVAILABLE',
    });
  });

  it('generates a run ID only when it is absent', async () => {
    const generated = io();
    await main({ argv: ['--link-id', LINK], ...generated });
    expect(generated.randomId).toHaveBeenCalledOnce();
    expect(generated.run).toHaveBeenCalledWith({ linkId: LINK, runId: RUN });

    const supplied = io();
    await main({
      argv: ['--link-id', LINK, '--run-id', RUN],
      ...supplied,
    });
    expect(supplied.randomId).not.toHaveBeenCalled();
    expect(supplied.run).toHaveBeenCalledWith({ linkId: LINK, runId: RUN });
  });
});
