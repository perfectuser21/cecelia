import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultExecAsync } from '../host-exec.js';
import { __resetOpsCollectorForTest, runOpsCollector } from '../ops-collector.js';
import { NOW, commandValue, fakePool } from './fixtures/ops-collector-command-values.mjs';

const execFileAsync = promisify(execFile);
const waitScript = 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500)';
const shellQuote = value => `'${value.replace(/'/g, `'\\''`)}'`;

async function captureError(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw Error('expected native child process failure');
}

async function collectWithFailure(error) {
  const pool = fakePool();
  const result = await runOpsCollector(pool, {
    inContainer: false,
    now: NOW,
    exec: async command => {
      if (command === 'launchctl list') throw error;
      return commandValue(command);
    },
  });
  expect(result.results.launchd.ok).toBe(false);
  expect(result.results.n8n).toEqual({ ok: true, workflows: 1 });
  return pool.queries.find(query => query.sql.includes('INSERT INTO ops_source_heartbeats') && query.params[0] === 'launchd').params.slice(3, 5);
}

describe('native child failures retain source heartbeat classification', () => {
  beforeEach(() => __resetOpsCollectorForTest());

  it('records an asynchronous local execution deadline as unreachable and continues other sources', async () => {
    const error = await captureError(() => defaultExecAsync(`exec ${shellQuote(process.execPath)} -e ${shellQuote(waitScript)}`, { timeoutMs: 50 }));
    expect(error).toMatchObject({ code: null, killed: true, signal: 'SIGTERM' });
    expect(error.message).not.toMatch(/timed? ?out|connect|unreachable|ETIMEDOUT/i);
    expect(await collectWithFailure(error)).toEqual(['unreachable', 'ssh_or_exec_failed']);
  });

  it('keeps native output buffer failures as parse errors', async () => {
    const error = await captureError(() => execFileAsync(process.execPath, ['-e', "process.stdout.write('x'.repeat(2048))"], { maxBuffer: 128 }));
    expect(error.code).toBe('ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
    expect(await collectWithFailure(error)).toEqual(['parse_error', 'parse_error']);
  });

  it('keeps a self-terminated process as a parse error', async () => {
    const error = await captureError(() => execFileAsync(process.execPath, ['-e', "process.kill(process.pid,'SIGTERM')"]));
    expect(error).toMatchObject({ code: null, killed: false, signal: 'SIGTERM' });
    expect(await collectWithFailure(error)).toEqual(['parse_error', 'parse_error']);
  });

  it('keeps a process killed by a different signal as a parse error', async () => {
    const operation = execFileAsync(process.execPath, ['-e', waitScript]);
    const failure = captureError(() => operation);
    operation.child.kill('SIGKILL');
    const error = await failure;
    expect(error).toMatchObject({ code: null, killed: true, signal: 'SIGKILL' });
    expect(await collectWithFailure(error)).toEqual(['parse_error', 'parse_error']);
  });

  it('keeps an ordinary nonzero exit as a parse error', async () => {
    const error = await captureError(() => execFileAsync(process.execPath, ['-e', 'process.exit(7)']));
    expect(error).toMatchObject({ code: 7, killed: false, signal: null });
    expect(await collectWithFailure(error)).toEqual(['parse_error', 'parse_error']);
  });
});
