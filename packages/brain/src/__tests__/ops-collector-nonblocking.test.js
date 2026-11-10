import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fork } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { runOpsCollector, __resetOpsCollectorForTest, INTERVAL_MS, N8N_LIST_CMD, CRONTAB_CMD_USVPS } from '../ops-collector.js';
import { NOW, values, commandValue, fakePool } from './fixtures/ops-collector-command-values.mjs';

beforeEach(() => __resetOpsCollectorForTest());
afterEach(() => vi.restoreAllMocks());

function event(child, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('fixture event timeout: ' + name)), 10000);
    const listener = message => {
      if (message.event !== name && message.event !== 'failed') return;
      clearTimeout(timer);
      child.off('message', listener);
      if (message.event === 'failed') reject(Error(message.error));
      else resolve(message);
    };
    child.on('message', listener);
  });
}

async function waitFile(path) {
  const end = Date.now() + 10000;
  while (!existsSync(path)) {
    if (Date.now() >= end) throw Error('native fixture did not reach N8N command');
    await delay(10);
  }
}

describe('Ops collector actual command lifecycle', () => {
  it('serves HTTP and heartbeat while its real default transport waits for N8N output', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ops-collector-http-'));
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    writeFileSync(join(directory, 'values.json'), JSON.stringify(Object.fromEntries(values)));
    writeFileSync(join(bin, 'ssh'), `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const root = process.env.OPS_COLLECTOR_FIXTURE;
const values = JSON.parse(fs.readFileSync(path.join(root, 'values.json')));
const args = process.argv.slice(2), remote = args.at(-1);
const command = args.includes('root@172.17.0.1') ? ${JSON.stringify(CRONTAB_CMD_USVPS)} : remote;
if (!Object.hasOwn(values, command)) throw Error('unrecognized fixed fixture command');
async function main() {
 if (command === ${JSON.stringify(N8N_LIST_CMD)}) {
  fs.writeFileSync(path.join(root, 'started.json'), JSON.stringify({ pid: process.pid }), { flag: 'wx' });
  const end = Date.now() + 6000;
  while (!fs.existsSync(path.join(root, 'release'))) {
   if (Date.now() >= end) throw Error('fixed fixture release deadline');
   await new Promise(resolve => setTimeout(resolve, 10));
  }
 }
 process.stdout.write(values[command]);
}
main().catch(() => { process.exitCode = 1; });
`, { mode: 0o700 });
    const child = fork(fileURLToPath(new URL('./fixtures/ops-collector-http-process.mjs', import.meta.url)), [], {
      env: { ...process.env, PATH: bin + ':' + process.env.PATH, OPS_COLLECTOR_FIXTURE: directory, CECELIA_HOST_EXEC_SSH: 'fixture@host.invalid' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr.on('data', bytes => { stderr += bytes; });
    const exited = once(child, 'exit');
    const finished = event(child, 'finished');
    let responseError;
    let response;
    let result;
    try {
      const ready = await event(child, 'ready');
      child.send('collect');
      await waitFile(join(directory, 'started.json'));
      try {
        response = await fetch('http://127.0.0.1:' + ready.port, { signal: AbortSignal.timeout(1000) });
        const body = await response.json();
        expect(body.ticks).toBeGreaterThan(0);
      } catch (error) { responseError = error; }
      expect(existsSync(join(directory, 'release'))).toBe(false);
    } finally {
      writeFileSync(join(directory, 'release'), 'release');
      try {
        result = await finished;
        await exited;
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        rmSync(directory, { recursive: true, force: true });
      }
    }
    expect(responseError, 'HTTP must respond before the N8N command is released; ' + stderr).toBeUndefined();
    expect(response.status).toBe(200);
    expect(result.result.results.n8n).toEqual({ ok: true, workflows: 1 });
    expect(result.queries.some(query => query.sql.includes('INSERT INTO ops_workflows') && query.params[0] === 'fixture-workflow')).toBe(true);
  }, 20000);

  it('awaits all async command output without changing sync snapshots or command order', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const run = async asynchronous => {
      __resetOpsCollectorForTest();
      const pool = fakePool(), calls = [];
      const exec = (command, options) => {
        calls.push({ command, options });
        const value = commandValue(command);
        return asynchronous ? Promise.resolve(value) : value;
      };
      return { result: await runOpsCollector(pool, { exec, inContainer: false, now: NOW }), queries: pool.queries, calls };
    };
    const sync = await run(false), asynchronous = await run(true);
    expect(asynchronous).toEqual(sync);
    expect(sync.calls).toHaveLength(11);
    expect(sync.calls.filter(call => call.options).map(call => call.options)).toEqual([{ timeoutMs: 120000 }]);
    expect(sync.calls.filter(call => call.command === CRONTAB_CMD_USVPS)).toHaveLength(1);
  });

  it('does not start another collection after observation ends while the actual invocation remains active', async () => {
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const firstPool = fakePool(), baseQuery = firstPool.query;
    let blocked = false;
    firstPool.query = async (...args) => {
      if (!blocked) { blocked = true; entered(); await gate; }
      return baseQuery(...args);
    };
    const first = runOpsCollector(firstPool, { exec: commandValue, inContainer: false, now: NOW });
    await started;
    const secondPool = fakePool(), secondExec = vi.fn(commandValue);
    try {
      const observed = await Promise.race([first, delay(1).then(() => 'observation-ended')]);
      expect(observed).toBe('observation-ended');
      const second = await runOpsCollector(secondPool, { exec: secondExec, inContainer: false, now: NOW + INTERVAL_MS + 1 });
      expect(second).toEqual({ skipped: true });
      expect(secondExec).not.toHaveBeenCalled();
      expect(secondPool.queries).toHaveLength(0);
    } finally { release(); await first; }
    const next = await runOpsCollector(fakePool(), { exec: commandValue, inContainer: false, now: NOW + 2 * INTERVAL_MS + 2 });
    expect(next.ok).toBe(true);
  });

  it('releases the actual invocation after an exception and keeps async source failure heartbeats', async () => {
    await expect(runOpsCollector({ query: async () => { throw Error('fixture database failure'); } }, { exec: commandValue, inContainer: false, now: NOW })).rejects.toThrow('fixture database failure');
    const pool = fakePool();
    const exec = command => {
      if (command === N8N_LIST_CMD) {
        const rejected = Promise.reject(Error('fixture connection timed out'));
        rejected.catch(() => {});
        return rejected;
      }
      return Promise.resolve(commandValue(command));
    };
    const result = await runOpsCollector(pool, { exec, inContainer: false, now: NOW + INTERVAL_MS + 1 });
    expect(result.results.n8n.ok).toBe(false);
    const heartbeat = pool.queries.find(query => query.sql.includes('INSERT INTO ops_source_heartbeats') && query.params[0] === 'n8n');
    expect(heartbeat.params.slice(0, 6)).toEqual(['n8n', 'hk-vps', null, 'unreachable', 'ssh_or_exec_failed', 'fixture connection timed out']);
  });
});
