import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const ALLOWED_KEYS = [
  'schema_version',
  'machine_id',
  'observed_at',
  'worker',
  'runner',
  'os',
  'orbstack',
  'docker',
  'resources',
  'git',
  'node',
  'codex',
  'tailscale',
  'callback',
  'time_sync',
  'power',
  'launchd',
  'worktree',
  'container',
  'drain',
];

function normalizeCjs(module) {
  return {
    ...(module.default && typeof module.default === 'object'
      ? module.default
      : {}),
    ...module,
  };
}

async function loadServerContract() {
  const server = normalizeCjs(
    await import('./fleet-worker.cjs').catch(() => ({})),
  );
  expect(server.createFleetWorkerServer, 'missing testable Fleet Worker CJS server').toBeTypeOf('function');
  return server;
}

async function loadProbeContract() {
  const probe = normalizeCjs(
    await import('./node-probe.cjs').catch(() => ({})),
  );
  expect(probe.probeFleetWorkerHealth, 'missing injected Node probe CJS seam').toBeTypeOf('function');
  return probe;
}

function responseDouble() {
  let resolve;
  const completed = new Promise((done) => { resolve = done; });
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body += String(chunk);
      resolve();
    },
    completed,
  };
}

async function request(server, method, url, { headers = {}, body } = {}) {
  const response = responseDouble();
  const input = new Readable({
    read() {
      if (body !== undefined) {
        this.push(typeof body === 'string' ? body : JSON.stringify(body));
      }
      this.push(null);
    },
  });
  input.method = method;
  input.url = url;
  input.headers = headers;
  server.emit('request', input, response);
  await response.completed;
  return response;
}

function safeHealth(sequence) {
  return {
    schema_version: 'fleet-node-health/v1',
    machine_id: 'us-mac-m4',
    observed_at: `2026-07-27T08:00:0${sequence}.000Z`,
    worker: { protocol_version: 'v1', contract_version: 'v1', version: '1.0.0' },
    runner: { version: '1.0.0', image_digest: DIGEST },
    os: { version: '15.5' },
    orbstack: { version: '1.9.4' },
    docker: { available: true, observed_at: `2026-07-27T08:00:0${sequence}.000Z` },
    resources: {
      cpu_cores: 6,
      memory_bytes: 8 * 1024 ** 3,
      disk_free_bytes: 40 * 1024 ** 3,
      disk_used_percent: 40,
      cpu_pressure_percent: 10,
      memory_pressure_percent: 20,
    },
    git: { available: true, version: '2.50.1' },
    node: { available: true, version: '22.17.0' },
    codex: { available: true, version: '0.40.0' },
    tailscale: { connected: true },
    callback: { reachable: true },
    time_sync: { synchronized: true },
    power: { sleep_disabled: true, auto_power_on: true },
    launchd: { loaded: true, domain: 'system', kind: 'LaunchDaemon' },
    worktree: { root_ready: true },
    container: { probe_succeeded: true },
    drain: { active: false },
  };
}

describe('Fleet Worker health-only service', () => {
  it('freshly reprobes health for every GET /health', async () => {
    const { createFleetWorkerServer } = await loadServerContract();
    let sequence = 0;
    const probeHealth = vi.fn(async () => safeHealth(++sequence));
    const server = createFleetWorkerServer({ probeHealth });

    const first = await request(server, 'GET', '/health');
    const second = await request(server, 'GET', '/health');

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(first.body).observed_at).not.toBe(JSON.parse(second.body).observed_at);
    expect(probeHealth).toHaveBeenCalledTimes(2);
    server.close();
  });

  it('rejects concurrent expensive probes without queuing and reprobes after release', async () => {
    const { createFleetWorkerServer } = await loadServerContract();
    let releaseFirst;
    const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
    let sequence = 0;
    const probeHealth = vi.fn(async () => {
      const current = ++sequence;
      if (current === 1) await firstPending;
      return safeHealth(current);
    });
    const server = createFleetWorkerServer({ probeHealth });

    const firstPendingResponse = request(server, 'GET', '/health');
    expect(probeHealth).toHaveBeenCalledTimes(1);

    const busy = await request(server, 'GET', '/health');

    expect(busy.statusCode).toBe(503);
    expect(JSON.parse(busy.body)).toEqual({ error: 'health_probe_busy' });
    expect(Buffer.byteLength(busy.body, 'utf8')).toBeLessThanOrEqual(1_024);
    expect(probeHealth).toHaveBeenCalledTimes(1);

    releaseFirst();
    const first = await firstPendingResponse;
    const next = await request(server, 'GET', '/health');

    expect(first.statusCode).toBe(200);
    expect(next.statusCode).toBe(200);
    expect(JSON.parse(first.body).observed_at)
      .not.toBe(JSON.parse(next.body).observed_at);
    expect(probeHealth).toHaveBeenCalledTimes(2);
    server.close();
  });

  it('freshly probes every command-backed fact and disposable Git/Docker check without a shell', async () => {
    const { probeFleetWorkerHealth } = await loadProbeContract();
    let tempSequence = 0;
    const createdContainerNames = [];
    const makeTempDirFn = vi.fn(async () => `/private/tmp/fleet-node-probe-${++tempSequence}`);
    const removeTempDirFn = vi.fn(async () => undefined);
    const fetchFn = vi.fn(async (url, options) => {
      expect(url).toBe('http://brain.internal:5221/api/brain/health');
      expect(options).toMatchObject({
        method: 'GET',
        signal: expect.any(AbortSignal),
      });
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const execFileFn = vi.fn(async (file, args, options) => {
      expect(file).toBeTypeOf('string');
      expect(args).toBeInstanceOf(Array);
      expect(options).toMatchObject({ shell: false });
      if (file === 'sw_vers') return { stdout: '15.5\n' };
      if (file === 'orbctl') return { stdout: '{"version":"1.9.4"}' };
      if (file === 'docker' && args[0] === 'info') return { stdout: '{"ServerVersion":"27.5"}' };
      if (file === 'docker' && args[0] === 'image') return { stdout: JSON.stringify([`runner@${DIGEST}`]) };
      if (file === 'docker' && args[0] === 'create') {
        const nameIndex = args.indexOf('--name');
        if (nameIndex >= 0) createdContainerNames.push(args[nameIndex + 1]);
        return { stdout: 'container-id\n' };
      }
      if (file === 'docker' && args[0] === 'start') return { stdout: '' };
      if (file === 'docker' && args[0] === 'rm') return { stdout: '' };
      if (file === 'git') return { stdout: 'git version 2.50.1\n' };
      if (file === 'node') return { stdout: 'v22.17.0\n' };
      if (file === 'codex') return { stdout: 'codex-cli 0.40.0\n' };
      if (file === 'tailscale') return { stdout: '{"BackendState":"Running"}' };
      if (file === 'pmset') return { stdout: ' sleep 0\n autorestart 1\n' };
      if (file === 'sysctl' && args.includes('hw.ncpu')) return { stdout: '6\n' };
      if (file === 'sysctl' && args.includes('hw.memsize')) {
        return { stdout: `${8 * 1024 ** 3}\n` };
      }
      if (file === 'sysctl' && args.includes('vm.loadavg')) {
        return { stdout: '{ 1.20 1.00 0.80 }\n' };
      }
      if (file === 'memory_pressure') {
        return { stdout: 'System-wide memory free percentage: 25%\n' };
      }
      if (file === 'df') {
        return {
          stdout: [
            'Filesystem 1024-blocks Used Available Capacity Mounted on',
            '/dev/disk3s1 100000000 40000000 60000000 40% /',
          ].join('\n'),
        };
      }
      if (file === 'launchctl') {
        return {
          stdout: [
            'system/com.perfect21.fleet-worker = {',
            '  state = running',
            '}',
          ].join('\n'),
        };
      }
      if (file === 'sntp') {
        return { stdout: 'time.apple.com: offset +0.042 seconds\n' };
      }
      return { stdout: '' };
    });

    const input = {
      machineId: 'us-mac-m4',
      runnerImageDigest: DIGEST,
      now: () => Date.parse('2026-07-27T08:00:00.000Z'),
      execFileFn,
      fetchFn,
      callbackUrl: 'http://brain.internal:5221/api/brain/health',
      makeTempDirFn,
      removeTempDirFn,
    };
    const first = await probeFleetWorkerHealth(input);
    const second = await probeFleetWorkerHealth(input);

    expect(first.docker.available).toBe(true);
    expect(second.runner.image_digest).toBe(DIGEST);
    for (const report of [first, second]) {
      expect(report.resources).toMatchObject({
        cpu_cores: 6,
        memory_bytes: 8 * 1024 ** 3,
        cpu_pressure_percent: 20,
        memory_pressure_percent: 75,
        disk_free_bytes: 60_000_000 * 1024,
        disk_used_percent: 40,
      });
      expect(report.launchd).toEqual({
        loaded: true,
        domain: 'system',
        kind: 'LaunchDaemon',
      });
      expect(report.time_sync).toEqual({ synchronized: true });
      expect(report.callback).toEqual({ reachable: true });
      expect(report.worktree).toEqual({ root_ready: true });
      expect(report.container).toEqual({ probe_succeeded: true });
    }
    const requiredCommands = [
      ['sw_vers', (args) => args.includes('-productVersion')],
      ['orbctl', (args) => args.length === 1 && args[0] === 'version'],
      ['docker', (args) => args[0] === 'info'],
      ['docker', (args) => args[0] === 'image'
        && args[1] === 'inspect'
        && args.includes(DIGEST)],
      ['git', (args) => args.includes('--version')],
      ['node', (args) => args.includes('--version')],
      ['codex', (args) => args.includes('--version')],
      ['tailscale', (args) => args[0] === 'status'],
      ['pmset', (args) => args[0] === '-g'],
      ['sysctl', (args) => args.includes('hw.ncpu')],
      ['sysctl', (args) => args.includes('hw.memsize')],
      ['sysctl', (args) => args.includes('vm.loadavg')],
      ['memory_pressure', (args) => args.includes('-Q')],
      ['df', (args) => args.includes('-k')],
      ['launchctl', (args) => args[0] === 'print'
        && args.includes('system/com.perfect21.fleet-worker')],
      ['sntp', (args) => args.length === 2
        && args[0] === '-d'
        && args[1] === 'time.apple.com'],
      ['git', (args) => args[0] === 'worktree'
        && args[1] === 'add'
        && args.includes('--detach')],
      ['git', (args) => args[0] === 'worktree'
        && args[1] === 'remove'
        && args.includes('--force')],
      ['docker', (args) => args[0] === 'create'
        && args.includes(DIGEST)
        && args.some((arg) => arg.includes('type=bind'))
        && args.includes('--entrypoint')
        && args.includes('/usr/bin/test')
        && args.includes('/workspace/.git')],
      ['docker', (args) => args[0] === 'start'
        && args[1] === '--attach'
        && createdContainerNames.includes(args[2])],
      ['docker', (args) => args[0] === 'rm'
        && args.includes('-f')
        && createdContainerNames.includes(args.at(-1))],
    ];
    for (const [file, matchesArgs] of requiredCommands) {
      const calls = execFileFn.mock.calls.filter(
        ([actualFile, args]) => actualFile === file && matchesArgs(args),
      );
      expect(calls, `${file} must be freshly probed on both calls`).toHaveLength(2);
    }
    for (const [, args, options] of execFileFn.mock.calls) {
      expect(args).toBeInstanceOf(Array);
      expect(options).toMatchObject({ shell: false });
    }
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(makeTempDirFn).toHaveBeenCalledTimes(2);
    expect(removeTempDirFn).toHaveBeenCalledTimes(2);
    expect(removeTempDirFn).toHaveBeenNthCalledWith(1, '/private/tmp/fleet-node-probe-1');
    expect(removeTempDirFn).toHaveBeenNthCalledWith(2, '/private/tmp/fleet-node-probe-2');
    expect(createdContainerNames).toHaveLength(2);
    expect(new Set(createdContainerNames).size).toBe(2);
    for (const name of createdContainerNames) {
      expect(name).toMatch(/^fleet-node-probe-[a-f0-9]{16}$/);
      expect(execFileFn).toHaveBeenCalledWith(
        'docker',
        ['start', '--attach', name],
        expect.objectContaining({ shell: false }),
      );
      expect(execFileFn).toHaveBeenCalledWith(
        'docker',
        ['rm', '-f', '--', name],
        expect.objectContaining({ shell: false }),
      );
    }
  });

  it.each([
    ['Git worktree add', 'git-add'],
    ['Docker create', 'docker-create'],
  ])('best-effort cleans deterministic targets after ambiguous %s failure', async (_label, failureAt) => {
    const { probeFleetWorkerHealth } = await loadProbeContract();
    const tempRoot = `/private/tmp/fleet-node-probe-${failureAt}`;
    const worktreePath = `${tempRoot}/worktree`;
    let containerName;
    const removeTempDirFn = vi.fn(async () => undefined);
    const missingDrainMarker = vi.fn(async () => {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    });
    const execFileFn = vi.fn(async (file, args, options) => {
      expect(args).toBeInstanceOf(Array);
      expect(options).toMatchObject({ shell: false });
      if (file === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        if (failureAt === 'git-add') throw new Error('timed out after worktree creation');
        return { stdout: '' };
      }
      if (file === 'docker' && args[0] === 'create') {
        containerName = args[args.indexOf('--name') + 1];
        throw new Error('timed out after container creation');
      }
      return { stdout: '' };
    });

    const report = await probeFleetWorkerHealth({
      machineId: 'us-mac-m4',
      runnerImageDigest: DIGEST,
      repoRoot: '/repo',
      execFileFn,
      fetchFn: vi.fn(async () => new Response('{}', { status: 200 })),
      makeTempDirFn: vi.fn(async () => tempRoot),
      removeTempDirFn,
      statFn: missingDrainMarker,
    });

    expect(report.container).toEqual({ probe_succeeded: false });
    expect(execFileFn).toHaveBeenCalledWith(
      'git',
      ['worktree', 'remove', '--force', worktreePath],
      expect.objectContaining({ cwd: '/repo', shell: false }),
    );
    if (failureAt === 'docker-create') {
      expect(containerName).toMatch(/^fleet-node-probe-[a-f0-9]{16}$/);
      expect(execFileFn).toHaveBeenCalledWith(
        'docker',
        ['rm', '-f', '--', containerName],
        expect.objectContaining({ shell: false }),
      );
    } else {
      expect(execFileFn.mock.calls).not.toContainEqual(
        expect.arrayContaining(['docker', expect.arrayContaining(['create'])]),
      );
    }
    expect(removeTempDirFn).toHaveBeenCalledOnce();
    expect(removeTempDirFn).toHaveBeenCalledWith(tempRoot);
  });

  it('returns only the health allowlist and strips authority, credentials, prompts, and local paths', async () => {
    const { createFleetWorkerServer } = await loadServerContract();
    const probeHealth = vi.fn(async () => ({
      ...safeHealth(1),
      account: 'team1',
      accounts: ['team1'],
      CODEX_ACCOUNT_ALLOWLIST: 'team1,team2',
      authorization: 'Bearer secret',
      auth: 'secret',
      token: 'secret',
      prompt: 'do something',
      credentials: { password: 'secret' },
      os: { version: `15.5-${'v'.repeat(100_000)}` },
      worker: {
        protocol_version: 'v1',
        contract_version: 'v1',
        version: 'w'.repeat(100_000),
      },
      worktree: { root_ready: true, path: '/Users/private/worktree' },
    }));
    const server = createFleetWorkerServer({ probeHealth });

    const response = await request(server, 'GET', '/health');
    const body = JSON.parse(response.body);
    const serialized = JSON.stringify(body);

    expect(Object.keys(body).sort()).toEqual([...ALLOWED_KEYS].sort());
    expect(Buffer.byteLength(response.body, 'utf8')).toBeLessThanOrEqual(65_536);
    const strings = [];
    JSON.stringify(body, (_key, value) => {
      if (typeof value === 'string') strings.push(value);
      return value;
    });
    expect(Math.max(...strings.map((value) => value.length))).toBeLessThanOrEqual(1_024);
    expect(serialized).not.toMatch(/account|allowlist|authori[sz]ation|auth|token|prompt|credential/i);
    expect(serialized).not.toContain('/Users/');
    server.close();
  });

  it.each([
    ['POST', '/health'],
    ['PUT', '/health'],
    ['DELETE', '/health'],
    ['POST', '/harness/attempts'],
    ['GET', '/harness/attempts'],
    ['POST', '/harness/attempts/123'],
    ['DELETE', '/harness/attempts/123'],
    ['POST', '/attempt'],
    ['POST', '/attempts'],
    ['POST', '/execute'],
    ['GET', '/execute'],
    ['POST', '/run'],
    ['POST', '/jobs'],
    ['PUT', '/jobs/123'],
    ['GET', '/arbitrary'],
  ])('rejects every route except GET /health: %s %s', async (method, url) => {
    const { createFleetWorkerServer } = await loadServerContract();
    const probeHealth = vi.fn(async () => safeHealth(1));
    const server = createFleetWorkerServer({ probeHealth });

    const response = await request(server, method, url);

    expect([404, 405]).toContain(response.statusCode);
    expect(probeHealth).not.toHaveBeenCalled();
    server.close();
  });
});

describe('Fleet Worker Attempt API', () => {
  const token = 'fleet-worker-token-at-least-32-bytes';
  const auth = { authorization: `Bearer ${token}` };
  const attemptId = '22222222-2222-4222-8222-222222222222';
  const runId = '11111111-1111-4111-8111-111111111111';

  function launchBody(overrides = {}) {
    return {
      attempt_id: attemptId,
      run_id: runId,
      lease_owner: 'dispatcher-1',
      lease_generation: 0,
      target: {
        machine: 'us-mac-m4',
        provider: 'codex',
        account: 'team1',
        model: 'gpt-5',
      },
      workspace_spec: {
        repo: 'perfectuser21/cecelia',
        base_sha: '0123456789abcdef0123456789abcdef01234567',
        branch: 'cp-07272050-worker-api',
        expected_head_sha: null,
        mode: 'read-write',
        run_id: runId,
        attempt_id: attemptId,
      },
      provider_spec: {
        provider: 'codex',
        command: 'codex',
        args: ['exec', '--json'],
        stdin: 'perform the bounded task',
        output: 'jsonl',
      },
      credential_envelope: {
        contract_version: 'credential-envelope/v1',
        credential_ref: '33333333-3333-4333-8333-333333333333',
        attempt_id: attemptId,
        account_id: 'team1',
        machine_id: 'us-mac-m4',
        issued_at: '2026-07-27T12:00:00.000Z',
        expires_at: '2026-07-27T14:00:00.000Z',
        payload_hash: `sha256:${'b'.repeat(64)}`,
        payload: 'transient-base64-payload',
      },
      callback_url: `http://brain.internal:5221/api/brain/harness/attempts/${attemptId}/callback`,
      callback_token: 'callback-token',
      ...overrides,
    };
  }

  function runnerDouble() {
    return {
      launch: vi.fn(async () => ({
        attempt_id: attemptId,
        actual_machine_id: 'us-mac-m4',
        execution_transport: 'fleet-worker',
        remote_job_id: 'container-1',
      })),
      inspect: vi.fn(async () => ({ attempt_id: attemptId, status: 'running' })),
      cancel: vi.fn(async () => ({ attempt_id: attemptId, status: 'cancelled' })),
      terminal: vi.fn(async () => ({ attempt_id: attemptId, status: 'cleaned' })),
      reconcile: vi.fn(async () => ({
        cleaned_attempts: [],
        removed_orphan_containers: [],
      })),
    };
  }

  it('launches an authenticated path-free Attempt and returns a bounded receipt', async () => {
    const { createFleetWorkerServer } = await loadServerContract();
    const attemptRunner = runnerDouble();
    const server = createFleetWorkerServer({
      probeHealth: vi.fn(async () => safeHealth(1)),
      attemptRunner,
      attemptToken: token,
    });

    const response = await request(server, 'POST', '/harness/attempts', {
      headers: { ...auth, 'content-type': 'application/json' },
      body: launchBody(),
    });

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toMatchObject({
      status: 'accepted',
      job_id: 'container-1',
      actual_machine_id: 'us-mac-m4',
      attestation: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(attemptRunner.launch).toHaveBeenCalledWith(launchBody());
    expect(response.body).not.toMatch(/callback-token|perform the bounded task/);
    server.close();
  });

  it.each([
    [{}, 401],
    [{ authorization: 'Bearer wrong-token' }, 401],
    [{ authorization: `Basic ${token}` }, 401],
  ])('rejects unauthenticated Attempt launch before runner invocation', async (
    headers,
    status,
  ) => {
    const { createFleetWorkerServer } = await loadServerContract();
    const attemptRunner = runnerDouble();
    const server = createFleetWorkerServer({
      probeHealth: vi.fn(async () => safeHealth(1)),
      attemptRunner,
      attemptToken: token,
    });

    const response = await request(server, 'POST', '/harness/attempts', {
      headers: { ...headers, 'content-type': 'application/json' },
      body: launchBody(),
    });

    expect(response.statusCode).toBe(status);
    expect(attemptRunner.launch).not.toHaveBeenCalled();
    server.close();
  });

  it.each([
    { cwd: '/Users/operator/perfect21/cecelia' },
    { worktree_path: '/tmp/operator-worktree' },
    { workspace_path: '../operator-worktree' },
  ])('rejects caller workspace coordinates before runner invocation: %j', async (
    injected,
  ) => {
    const { createFleetWorkerServer } = await loadServerContract();
    const attemptRunner = runnerDouble();
    const server = createFleetWorkerServer({
      probeHealth: vi.fn(async () => safeHealth(1)),
      attemptRunner,
      attemptToken: token,
    });

    const response = await request(server, 'POST', '/harness/attempts', {
      headers: { ...auth, 'content-type': 'application/json' },
      body: launchBody(injected),
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/untrusted_workspace_field/);
    expect(attemptRunner.launch).not.toHaveBeenCalled();
    server.close();
  });

  it('rejects malformed and oversized JSON without invoking the runner', async () => {
    const { createFleetWorkerServer } = await loadServerContract();
    const attemptRunner = runnerDouble();
    const server = createFleetWorkerServer({
      probeHealth: vi.fn(async () => safeHealth(1)),
      attemptRunner,
      attemptToken: token,
      maxRequestBytes: 256,
    });

    const malformed = await request(server, 'POST', '/harness/attempts', {
      headers: { ...auth, 'content-type': 'application/json' },
      body: '{"broken":',
    });
    const oversized = await request(server, 'POST', '/harness/attempts', {
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(300) }),
    });

    expect(malformed.statusCode).toBe(400);
    expect(oversized.statusCode).toBe(413);
    expect(attemptRunner.launch).not.toHaveBeenCalled();
    server.close();
  });

  it('serves authenticated inspect, cancel, and terminal lifecycle routes', async () => {
    const { createFleetWorkerServer } = await loadServerContract();
    const attemptRunner = runnerDouble();
    const server = createFleetWorkerServer({
      probeHealth: vi.fn(async () => safeHealth(1)),
      attemptRunner,
      attemptToken: token,
    });

    const inspected = await request(
      server,
      'GET',
      `/harness/attempts/${attemptId}`,
      { headers: auth },
    );
    const cancelled = await request(
      server,
      'POST',
      `/harness/attempts/${attemptId}/cancel`,
      {
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          lease_owner: 'dispatcher-1',
          lease_generation: 0,
        }),
      },
    );
    const terminal = await request(
      server,
      'POST',
      `/harness/attempts/${attemptId}/terminal`,
      {
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          lease_owner: 'dispatcher-1',
          lease_generation: 0,
        }),
      },
    );

    expect(inspected.statusCode).toBe(200);
    expect(cancelled.statusCode).toBe(200);
    expect(JSON.parse(cancelled.body)).toEqual({
      attempt_id: attemptId,
      status: 'cancelled',
    });
    expect(terminal.statusCode).toBe(200);
    expect(attemptRunner.inspect).toHaveBeenCalledWith(attemptId);
    expect(attemptRunner.cancel).toHaveBeenCalledWith(attemptId, {
      owner: 'dispatcher-1',
      generation: 0,
    });
    expect(attemptRunner.terminal).toHaveBeenCalledWith(attemptId, {
      owner: 'dispatcher-1',
      generation: 0,
    });
    server.close();
  });

  it('returns 409 when cancellation races a durable callback receipt', async () => {
    const { createFleetWorkerServer } = await loadServerContract();
    const attemptRunner = runnerDouble();
    attemptRunner.cancel.mockRejectedValue(new Error('attempt_callback_pending'));
    const server = createFleetWorkerServer({
      probeHealth: vi.fn(async () => safeHealth(1)),
      attemptRunner,
      attemptToken: token,
    });

    const response = await request(
      server,
      'POST',
      `/harness/attempts/${attemptId}/cancel`,
      {
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          lease_owner: 'dispatcher-1',
          lease_generation: 0,
        }),
      },
    );

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({
      error: 'attempt_callback_pending',
    });
    server.close();
  });

  it('keeps Attempt traffic closed until startup reconciliation completes', async () => {
    const { createFleetWorkerServer } = await loadServerContract();
    let release;
    const reconciling = new Promise((resolve) => { release = resolve; });
    const attemptRunner = runnerDouble();
    attemptRunner.reconcile.mockImplementationOnce(async () => reconciling);
    const server = createFleetWorkerServer({
      probeHealth: vi.fn(async () => safeHealth(1)),
      attemptRunner,
      attemptToken: token,
    });

    const busy = await request(server, 'POST', '/harness/attempts', {
      headers: { ...auth, 'content-type': 'application/json' },
      body: launchBody(),
    });
    expect(busy.statusCode).toBe(503);
    expect(JSON.parse(busy.body)).toEqual({ error: 'worker_reconciling' });
    expect(attemptRunner.launch).not.toHaveBeenCalled();

    release({
      cleaned_attempts: [],
      removed_orphan_containers: [],
    });
    await vi.waitFor(() => expect(attemptRunner.reconcile).toHaveBeenCalledOnce());
    const accepted = await request(server, 'POST', '/harness/attempts', {
      headers: { ...auth, 'content-type': 'application/json' },
      body: launchBody(),
    });
    expect(accepted.statusCode).toBe(202);
    server.close();
  });

  it('self-heals a transient startup reconciliation failure on the retry timer', async () => {
    const { createFleetWorkerServer } = await loadServerContract();
    const attemptRunner = runnerDouble();
    attemptRunner.reconcile
      .mockRejectedValueOnce(new Error('transient state IO failure'))
      .mockResolvedValueOnce({
        cleaned_attempts: [],
        cancelled_attempts: [],
        removed_orphan_containers: [],
      });
    const intervals = [];
    const server = createFleetWorkerServer({
      probeHealth: vi.fn(async () => safeHealth(1)),
      attemptRunner,
      attemptToken: token,
      setIntervalFn: (callback, milliseconds) => {
        const timer = { callback, milliseconds, unref: vi.fn() };
        intervals.push(timer);
        return timer;
      },
      clearIntervalFn: vi.fn(),
    });
    await vi.waitFor(() => expect(attemptRunner.reconcile).toHaveBeenCalledOnce());

    const failed = await request(server, 'POST', '/harness/attempts', {
      headers: { ...auth, 'content-type': 'application/json' },
      body: launchBody(),
    });
    expect(failed.statusCode).toBe(503);
    expect(JSON.parse(failed.body)).toEqual({
      error: 'worker_reconciliation_failed',
    });

    const retryTimer = intervals.find(({ milliseconds }) => milliseconds === 30_000);
    retryTimer.callback();
    await vi.waitFor(() => {
      expect(attemptRunner.reconcile).toHaveBeenCalledTimes(2);
    });
    await new Promise((resolve) => setImmediate(resolve));

    const accepted = await request(server, 'POST', '/harness/attempts', {
      headers: { ...auth, 'content-type': 'application/json' },
      body: launchBody(),
    });
    expect(accepted.statusCode).toBe(202);
    server.close();
  });

  it('periodically retries durable callbacks and renews leases with bounded single-flight loops', async () => {
    const { createFleetWorkerServer } = await loadServerContract();
    const attemptRunner = runnerDouble();
    let releaseRetry;
    const retryInFlight = new Promise((resolve) => { releaseRetry = resolve; });
    attemptRunner.reconcile
      .mockResolvedValueOnce({
        cleaned_attempts: [],
        removed_orphan_containers: [],
      })
      .mockImplementationOnce(async () => retryInFlight);
    const maintenance = {
      heartbeatAll: vi.fn(async () => ({
        attempted: 1,
        accepted: 1,
        failed: 0,
      })),
    };
    const intervals = [];
    const cleared = [];
    const server = createFleetWorkerServer({
      probeHealth: vi.fn(async () => safeHealth(1)),
      attemptRunner,
      attemptToken: token,
      maintenance,
      setIntervalFn: (callback, milliseconds) => {
        const timer = { callback, milliseconds, unref: vi.fn() };
        intervals.push(timer);
        return timer;
      },
      clearIntervalFn: (timer) => cleared.push(timer),
    });
    await vi.waitFor(() => expect(attemptRunner.reconcile).toHaveBeenCalledOnce());

    expect(intervals.map(({ milliseconds }) => milliseconds).sort()).toEqual([
      30_000,
      60_000,
    ]);
    const retryTimer = intervals.find(({ milliseconds }) => milliseconds === 30_000);
    const heartbeatTimer = intervals.find(({ milliseconds }) => milliseconds === 60_000);
    retryTimer.callback();
    retryTimer.callback();
    heartbeatTimer.callback();
    heartbeatTimer.callback();

    await vi.waitFor(() => {
      expect(attemptRunner.reconcile).toHaveBeenCalledTimes(2);
      expect(maintenance.heartbeatAll).toHaveBeenCalledOnce();
    });
    releaseRetry({
      cleaned_attempts: [],
      removed_orphan_containers: [],
    });
    server.emit('close');
    expect(cleared).toHaveLength(2);
  });
});

describe('Fleet Worker production runtime assembly', () => {
  it('assembles durable Worker-owned roots and reads auth only from a protected file', async () => {
    const { createFleetWorkerRuntime } = await loadServerContract();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-worker-runtime-'));
    const tokenFile = path.join(root, 'worker-token');
    const dataRoot = path.join(root, 'data');
    fs.writeFileSync(tokenFile, 'fleet-worker-token-at-least-32-bytes\n', {
      mode: 0o600,
    });

    try {
      const runtime = createFleetWorkerRuntime({
        env: {
          CECELIA_MACHINE_ID: 'us-mac-m4',
          CECELIA_RUNNER_DIGEST: `sha256:${'a'.repeat(64)}`,
          CECELIA_FLEET_WORKER_TOKEN_FILE: tokenFile,
          CECELIA_FLEET_DATA_ROOT: dataRoot,
          CECELIA_FLEET_REPO_SOURCE: 'https://github.com/perfectuser21/cecelia.git',
        },
        runCommand: vi.fn(),
      });

      expect(runtime.attemptToken).toBe('fleet-worker-token-at-least-32-bytes');
      expect(runtime.attemptRunner).toMatchObject({
        launch: expect.any(Function),
        reconcile: expect.any(Function),
      });
      expect(runtime.roots).toEqual({
        mirrors: path.join(dataRoot, 'mirrors'),
        worktrees: path.join(dataRoot, 'worktrees'),
        quarantine: path.join(dataRoot, 'quarantine'),
        state: path.join(dataRoot, 'state'),
        runtime: path.join(dataRoot, 'runtime'),
        credentials: path.join(dataRoot, 'credential-consumption'),
      });
      expect(JSON.stringify(runtime)).not.toContain(
        'https://github.com/perfectuser21/cecelia.git',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not accept an inline long-lived Worker token in place of the token file', async () => {
    const { createFleetWorkerRuntime } = await loadServerContract();

    expect(() => createFleetWorkerRuntime({
      env: {
        CECELIA_MACHINE_ID: 'us-mac-m4',
        CECELIA_RUNNER_DIGEST: `sha256:${'a'.repeat(64)}`,
        CECELIA_FLEET_DATA_ROOT: '/var/lib/cecelia/fleet-worker',
        CECELIA_FLEET_WORKER_TOKEN: 'inline-token-must-not-be-trusted',
      },
      runCommand: vi.fn(),
    })).toThrow(/fleet_worker_token_file_required/);
  });

  it('rejects a symlink in place of the protected Worker token file', async () => {
    const { createFleetWorkerRuntime } = await loadServerContract();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-worker-token-'));
    const target = path.join(root, 'token-target');
    const tokenFile = path.join(root, 'worker-token');
    fs.writeFileSync(target, 'fleet-worker-token-at-least-32-bytes\n', {
      mode: 0o600,
    });
    fs.symlinkSync(target, tokenFile);

    try {
      expect(() => createFleetWorkerRuntime({
        env: {
          CECELIA_MACHINE_ID: 'us-mac-m4',
          CECELIA_RUNNER_DIGEST: `sha256:${'a'.repeat(64)}`,
          CECELIA_FLEET_DATA_ROOT: path.join(root, 'data'),
          CECELIA_FLEET_WORKER_TOKEN_FILE: tokenFile,
        },
        runCommand: vi.fn(),
      })).toThrow(/fleet_worker_token_file_permissions/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an oversized protected Worker token before reading authority', async () => {
    const { createFleetWorkerRuntime } = await loadServerContract();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-worker-token-size-'));
    const tokenFile = path.join(root, 'worker-token');
    fs.writeFileSync(tokenFile, 'x'.repeat(8_193), { mode: 0o600 });

    try {
      expect(() => createFleetWorkerRuntime({
        env: {
          CECELIA_MACHINE_ID: 'us-mac-m4',
          CECELIA_RUNNER_DIGEST: `sha256:${'a'.repeat(64)}`,
          CECELIA_FLEET_DATA_ROOT: path.join(root, 'data'),
          CECELIA_FLEET_WORKER_TOKEN_FILE: tokenFile,
        },
        runCommand: vi.fn(),
      })).toThrow(/fleet_worker_token_file_permissions/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
