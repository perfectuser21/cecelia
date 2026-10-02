import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);
const { probeFleetWorkerHealth } = require('../../../packages/brain/scripts/fleet-worker/node-probe.cjs');
const { createFleetWorkerServer } = require('../../../packages/brain/scripts/fleet-worker/fleet-worker.cjs');
const runRealChild = promisify(execFile);
const servers = [];
const SENTINEL = 'SECRET_CLOCK_DIAGNOSTIC_SENTINEL';
afterEach(() => { for (const server of servers.splice(0)) server.close(); });

async function probeWithClock(clockCommand) {
  const clockCalls = [];
  const report = await probeFleetWorkerHealth({
    platform: 'darwin', machineId: 'xian-mac-m4', env: {},
    runnerImageDigest: `sha256:${'a'.repeat(64)}`,
    execFileFn: async (file, args, options) => {
      if (file !== 'sntp') return { stdout: '', stderr: '' };
      clockCalls.push({ args, options });
      return clockCommand(options);
    },
    fetchFn: async () => new Response('{}', { status: 200 }),
    makeTempDirFn: async () => '/private/tmp/clock-diagnostic-unit-fixture',
    chmodTempDirFn: async () => undefined,
    removeTempDirFn: async () => undefined,
    statFn: async () => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); },
  });
  expect(clockCalls).toHaveLength(1);
  expect(clockCalls[0]).toMatchObject({
    args: ['-d', 'time.apple.com'],
    options: { shell: false, timeout: 5000, maxBuffer: 65536, encoding: 'utf8' },
  });
  return report;
}

function readyHealth(diagnostic, synchronized = false) {
  return {
    observed_at: '2026-10-02T19:50:17.640Z',
    orbstack: { version: '2.2.1' }, docker: { available: true },
    tailscale: { connected: true }, callback: { reachable: true },
    worktree: { root_ready: true }, container: { probe_succeeded: true },
    runtime_resources: { postgres: { available: true } },
    time_sync: { synchronized, ...(diagnostic ? { diagnostic } : {}) },
  };
}

async function healthRequest(server) {
  let done;
  const completed = new Promise((resolve) => { done = resolve; });
  let body = '';
  const response = {
    writeHead() {},
    end(chunk = '') { body += String(chunk); done(); },
  };
  const request = new Readable({ read() { this.push(null); } });
  Object.assign(request, { method: 'GET', url: '/health', headers: {} });
  server.emit('request', request, response);
  await completed;
  return JSON.parse(body);
}

function serverFor(options) {
  const server = createFleetWorkerServer(options);
  servers.push(server);
  return server;
}

describe('clock diagnostic preserves the existing fail-closed command policy', () => {
  it('retains real exit 69 even when the failed child prints a valid-looking zero offset', async () => {
    const report = await probeWithClock((options) => runRealChild(process.execPath, ['-e',
      `process.stdout.write('offset +0.0 seconds\\n');process.stderr.write('${SENTINEL}');process.exit(69);`,
    ], { ...options, env: {} }));
    expect(report.time_sync.synchronized).toBe(false);
    expect(report.time_sync.diagnostic).toMatchObject({ category: 'command_exit', exit_code: 69 });
    const body = await healthRequest(serverFor({ probeHealth: async () => report, healthCacheTtlMs: 0 }));
    expect(body.time_sync.synchronized).toBe(false);
    expect(body.time_sync.diagnostic).toMatchObject({ category: 'command_exit', exit_code: 69 });
    expect(JSON.stringify(body)).not.toContain(SENTINEL);
    expect(body.time_sync.diagnostic).not.toHaveProperty('stdout');
    expect(body.time_sync.diagnostic).not.toHaveProperty('stderr');
    expect(body.time_sync.diagnostic).not.toHaveProperty('stack');
  });

  it('reports a real killed child without changing the production five-second timeout', async () => {
    const report = await probeWithClock((options) => runRealChild(process.execPath, ['-e',
      `process.stdout.write('offset +0.0 seconds\\n');process.stderr.write('${SENTINEL}');setInterval(()=>{},1000);`,
    ], { ...options, env: {} }));
    expect(report.time_sync.synchronized).toBe(false);
    expect(report.time_sync.diagnostic).toMatchObject({
      category: 'command_terminated', killed: true, signal: 'SIGTERM', configured_timeout_ms: 5000,
    });
    expect(report.time_sync.diagnostic.duration_ms).toBeGreaterThanOrEqual(4900);
    expect(JSON.stringify(report.time_sync)).not.toContain(SENTINEL);
  }, 15000);

  it.each([
    ['offset +0.042 seconds', true, 'passed', 'within_policy'],
    ['offset +1.001 seconds', false, 'offset_outside_limit', 'outside_policy'],
    [`unparseable ${SENTINEL}`, false, 'offset_unparseable', 'not_parseable'],
  ])('classifies successful output without changing its existing boolean: %s', async (stdout, synchronized, category, parseStatus) => {
    const report = await probeWithClock(async () => ({ stdout, stderr: '' }));
    expect(report.time_sync.synchronized).toBe(synchronized);
    expect(report.time_sync.diagnostic).toMatchObject({ category, exit_code: 0, parse_status: parseStatus });
    expect(JSON.stringify(report.time_sync)).not.toContain(SENTINEL);
  });

  it.each([null, undefined, 0, ''])('does not label falsy command rejections as successful: %s', async (rejection) => {
    const report = await probeWithClock(async () => { throw rejection; });
    expect(report.time_sync.synchronized).toBe(false);
    expect(report.time_sync.diagnostic).toMatchObject({
      category: 'command_failed', exit_code: null, parse_status: 'not_evaluated',
    });
    expect(report.time_sync.diagnostic.category).not.toBe('passed');
  });

  it.each([
    ['ENOENT', 'command_not_found'],
    ['EACCES', 'command_permission_denied'],
    ['ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'command_buffer_limit'],
    [`UNKNOWN_${SENTINEL}`, 'command_failed'],
  ])('maps execution errors to fixed categories without exposing error strings: %s', async (code, category) => {
    const report = await probeWithClock(async () => {
      throw Object.assign(new Error(SENTINEL), { code, stdout: SENTINEL, stderr: SENTINEL, stack: SENTINEL });
    });
    expect(report.time_sync.synchronized).toBe(false);
    expect(report.time_sync.diagnostic).toMatchObject({ category });
    expect(JSON.stringify(report.time_sync)).not.toContain(SENTINEL);
  });
});

describe('clock diagnostic HTTP sample provenance and strict projection', () => {
  it('labels fresh, cache-hit and TTL-expired samples without modifying the cache object or policy', async () => {
    let now = 1000000;
    const diagnostic = Object.freeze({ category: 'command_exit', exit_code: 69, parse_status: 'not_evaluated' });
    const report = readyHealth(diagnostic);
    const probeHealth = vi.fn(async () => report);
    const server = serverFor({ probeHealth, now: () => now, healthCacheTtlMs: 30000 });
    const first = await healthRequest(server);
    now += 100;
    const cached = await healthRequest(server);
    expect(probeHealth).toHaveBeenCalledTimes(1);
    expect(cached.observed_at).toBe(report.observed_at);
    now += 30000;
    const next = await healthRequest(server);
    expect(probeHealth).toHaveBeenCalledTimes(2);
    expect(first.time_sync.synchronized).toBe(false);
    expect(cached.time_sync.synchronized).toBe(false);
    expect(first.time_sync.diagnostic).toMatchObject({ sample_origin: 'fresh_probe' });
    expect(cached.time_sync.diagnostic).toMatchObject({ sample_origin: 'cache_hit' });
    expect(next.time_sync.diagnostic).toMatchObject({ sample_origin: 'fresh_probe' });
    expect(report.time_sync.diagnostic).toBe(diagnostic);
    expect(diagnostic).not.toHaveProperty('sample_origin');
  });

  it('labels a shared in-flight response while keeping exactly one actual probe', async () => {
    let release;
    const probeHealth = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const server = serverFor({ probeHealth, healthCacheTtlMs: 0 });
    const first = healthRequest(server);
    const joiner = healthRequest(server);
    expect(probeHealth).toHaveBeenCalledTimes(1);
    release(readyHealth({ category: 'passed', exit_code: 0, parse_status: 'within_policy' }, true));
    const [a, b] = await Promise.all([first, joiner]);
    expect(a.time_sync.diagnostic).toMatchObject({ sample_origin: 'fresh_probe' });
    expect(b.time_sync.diagnostic).toMatchObject({ sample_origin: 'shared_inflight' });
    expect(a.time_sync.synchronized).toBe(true);
    expect(b.time_sync.synchronized).toBe(true);
  });

  it('projects only known diagnostic fields and replaces caller-controlled sample origin', async () => {
    const diagnostic = {
      category: 'command_exit', exit_code: 69, parse_status: 'not_evaluated',
      sample_origin: SENTINEL, raw_stderr: SENTINEL, stack: SENTINEL,
      argv: [SENTINEL], env: { TOKEN: SENTINEL },
      configured_timeout_ms: 5000, configured_max_buffer: 65536,
      duration_ms: Number.POSITIVE_INFINITY,
    };
    const body = await healthRequest(serverFor({ probeHealth: async () => readyHealth(diagnostic) }));
    expect(body.time_sync.diagnostic).toMatchObject({ category: 'command_exit', exit_code: 69, sample_origin: 'fresh_probe' });
    expect(JSON.stringify(body)).not.toContain(SENTINEL);
    expect(body.time_sync.diagnostic).not.toHaveProperty('raw_stderr');
    expect(body.time_sync.diagnostic).not.toHaveProperty('env');
    expect(body.time_sync.diagnostic).not.toHaveProperty('argv');
  });

  it('drops malicious enums rather than turning arbitrary strings into public diagnostic authority', async () => {
    const body = await healthRequest(serverFor({ probeHealth: async () => readyHealth({
      category: SENTINEL, parse_status: SENTINEL, signal: SENTINEL, exit_code: SENTINEL,
    }) }));
    expect(body.time_sync.diagnostic).toBeDefined();
    expect(body.time_sync.diagnostic.sample_origin).toBe('fresh_probe');
    expect(JSON.stringify(body)).not.toContain(SENTINEL);
    expect(body.time_sync.synchronized).toBe(false);
  });

  it('continues serving legacy boolean-only reports without inventing an observation', async () => {
    const body = await healthRequest(serverFor({ probeHealth: async () => readyHealth(undefined) }));
    expect(body.time_sync).toEqual({ synchronized: false });
  });
});
