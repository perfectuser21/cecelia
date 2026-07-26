import { EventEmitter } from 'node:events';
import { spawn as spawnProcess } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createKernelAttemptHandler } from '../../scripts/codex-bridge/kernel-attempt-handler.cjs';
import {
  CANARY_NO_TOOL_ARGS,
  codexAdapter,
} from '../orchestrator/providers/codex.js';

const require = createRequire(import.meta.url);
const { createBridgeServer } = require('../../scripts/codex-bridge/codex-bridge.cjs');

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';
const BRIDGE_TOKEN = 'bridge-token-that-is-at-least-32-bytes';
const CALLBACK_TOKEN = 'callback-token-that-must-never-leak';
const BRAIN_URL = 'https://brain.example';
const SCHEMA_PATH = `/tmp/harness-${ATTEMPT_ID}.schema.json`;
const RESULT_PATH = `/tmp/harness-${ATTEMPT_ID}.result.json`;
const SESSION_ID = '55555555-5555-4555-8555-555555555555';

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = { end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function expectOpenAiStrictSchema(schema) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'object') {
    expect(schema.additionalProperties).toBe(false);
    const propertyNames = Object.keys(schema.properties ?? {}).sort();
    expect([...(schema.required ?? [])].sort()).toEqual(propertyNames);
  }
  for (const child of Object.values(schema.properties ?? {})) {
    expectOpenAiStrictSchema(child);
  }
  for (const child of schema.anyOf ?? []) {
    expectOpenAiStrictSchema(child);
  }
}

function request(overrides = {}) {
  return {
    attempt_id: ATTEMPT_ID,
    run_id: RUN_ID,
    lease_owner: 'dispatcher:test',
    lease_generation: 0,
    target: {
      provider: 'codex',
      account: 'team3',
      machine: 'xian-mac-m4',
    },
    provider_spec: {
      provider: 'codex',
      command: 'codex',
      args: [
        'exec',
        '--json',
        '--output-schema', SCHEMA_PATH,
        '--output-last-message', RESULT_PATH,
        '--skip-git-repo-check',
        '-',
      ],
      stdin: '{"task_bundle":{}}',
      output: {
        format: 'jsonl',
        schema_path: SCHEMA_PATH,
        result_path: RESULT_PATH,
      },
    },
    callback_url: `${BRAIN_URL}/api/brain/harness/attempts/${ATTEMPT_ID}/callback`,
    callback_token: CALLBACK_TOKEN,
    ...overrides,
  };
}

function canaryProviderSpec(overrides = {}) {
  const base = request().provider_spec;
  return {
    ...base,
    args: [base.args[0], ...CANARY_NO_TOOL_ARGS, ...base.args.slice(1)],
    workspace: {
      kind: 'disposable-canary-v1',
      attempt_id: ATTEMPT_ID,
    },
    ...overrides,
  };
}

function auth() {
  return { authorization: `Bearer ${BRIDGE_TOKEN}` };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function close(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  });
}

function runClaimWorker({
  handlerPath,
  stateDir,
  barrierDir,
  spawnLog,
  workerId,
}) {
  const script = String.raw`
    const fs = require('fs');
    const path = require('path');
    const { EventEmitter } = require('events');
    const [handlerPath, stateDir, barrierDir, spawnLog, workerId] = process.argv.slice(1);
    const attemptId = '${ATTEMPT_ID}';
    const targetPath = path.join(stateDir, attemptId + '.json');
    const waitForPeer = (destination) => {
      if (destination !== targetPath) return;
      fs.writeFileSync(path.join(barrierDir, 'ready-' + workerId), '');
      const waitArray = new Int32Array(new SharedArrayBuffer(4));
      const deadline = Date.now() + 5000;
      while (fs.readdirSync(barrierDir).filter(name => name.startsWith('ready-')).length < 2) {
        if (Date.now() > deadline) throw new Error('claim barrier timeout');
        Atomics.wait(waitArray, 0, 0, 10);
      }
    };
    const renameSync = fs.renameSync;
    fs.renameSync = (source, destination) => {
      waitForPeer(destination);
      return renameSync(source, destination);
    };
    const linkSync = fs.linkSync;
    fs.linkSync = (source, destination) => {
      waitForPeer(destination);
      return linkSync(source, destination);
    };
    const { createKernelAttemptHandler } = require(handlerPath);
    const fakeChild = () => {
      const child = new EventEmitter();
      child.stdin = { end() {} };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      return child;
    };
    const handler = createKernelAttemptHandler({
      stateDir,
      machineId: 'xian-mac-m4',
      spawnFn: () => {
        fs.appendFileSync(spawnLog, workerId + '\n');
        return fakeChild();
      },
      randomUUID: () => workerId === '1'
        ? '33333333-3333-4333-8333-333333333333'
        : '44444444-4444-4444-8444-444444444444',
      bridgeToken: '${BRIDGE_TOKEN}',
      brainUrl: '${BRAIN_URL}',
      allowedAccounts: ['team3'],
      codexBin: '/opt/homebrew/bin/codex',
      workDir: stateDir,
      loadAccountAuth: () => ({ tokens: { access_token: 'provider-secret' } }),
      fetchFn: async () => ({ ok: true, status: 200 }),
      runtimeRoot: stateDir,
    });
    handler.accept(${JSON.stringify(request())}, {
      authorization: 'Bearer ${BRIDGE_TOKEN}',
    }).then(() => process.exit(0)).catch(error => {
      process.stderr.write(error.stack || error.message);
      process.exit(1);
    });
  `;

  return new Promise((resolve, reject) => {
    const child = spawnProcess(process.execPath, [
      '-e',
      script,
      handlerPath,
      stateDir,
      barrierDir,
      spawnLog,
      String(workerId),
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`claim worker ${workerId} failed: ${stderr}`));
    });
  });
}

function runCallbackReconcileWorker({
  handlerPath,
  stateDir,
  barrierDir,
  resultPath,
  role,
}) {
  const script = String.raw`
    const fs = require('fs');
    const path = require('path');
    const [handlerPath, stateDir, barrierDir, resultPath, role] = process.argv.slice(1);
    const attemptId = '${ATTEMPT_ID}';
    const targetPath = path.join(stateDir, attemptId + '.json');
    const waitArray = new Int32Array(new SharedArrayBuffer(4));
    const waitFor = (marker) => {
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(path.join(barrierDir, marker))) {
        if (Date.now() > deadline) throw new Error('callback reconcile barrier timeout: ' + marker);
        Atomics.wait(waitArray, 0, 0, 10);
      }
    };
    if (role === 'reconciler') {
      const readFileSync = fs.readFileSync;
      let paused = false;
      fs.readFileSync = (filePath, ...args) => {
        const value = readFileSync(filePath, ...args);
        if (!paused && filePath === targetPath) {
          paused = true;
          fs.writeFileSync(resultPath + '.captured', value);
          fs.writeFileSync(path.join(barrierDir, 'reconciler-read'), '');
          waitFor('owner-acquired');
        }
        return value;
      };
    } else {
      waitFor('reconciler-read');
    }
    const { createKernelAttemptHandler } = require(handlerPath);
    const handler = createKernelAttemptHandler({
      stateDir,
      machineId: 'xian-mac-m4',
      spawnFn: () => { throw new Error('callback redelivery must not respawn'); },
      bridgeToken: '${BRIDGE_TOKEN}',
      brainUrl: '${BRAIN_URL}',
      allowedAccounts: ['team3'],
      codexBin: '/opt/homebrew/bin/codex',
      workDir: stateDir,
      loadAccountAuth: () => ({ tokens: { access_token: 'provider-secret' } }),
      fetchFn: async () => {
        fs.writeFileSync(path.join(barrierDir, 'owner-acquired'), '');
        waitFor('reconciler-finished');
        return { ok: true, status: 200 };
      },
      runtimeRoot: stateDir,
    });
    if (role === 'reconciler') {
      fs.writeFileSync(
        resultPath + '.reconciler',
        fs.readFileSync(targetPath, 'utf8'),
      );
      fs.writeFileSync(path.join(barrierDir, 'reconciler-finished'), '');
      process.exit(0);
    }
    handler.accept(${JSON.stringify(request())}, {
      authorization: 'Bearer ${BRIDGE_TOKEN}',
    }).then(() => new Promise(resolve => setImmediate(resolve)))
      .then(() => handler.inspect(attemptId, {
        authorization: 'Bearer ${BRIDGE_TOKEN}',
      }))
      .then(claim => {
        fs.writeFileSync(resultPath, JSON.stringify(claim));
        process.exit(0);
      })
      .catch(error => {
        process.stderr.write(error.stack || error.message);
        process.exit(1);
      });
  `;

  return new Promise((resolve, reject) => {
    const child = spawnProcess(process.execPath, [
      '-e',
      script,
      handlerPath,
      stateDir,
      barrierDir,
      resultPath,
      role,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`callback reconcile ${role} failed: ${stderr}`));
    });
  });
}

describe('kernel attempt durable claims', () => {
  let stateDir;
  let spawnFn;
  let deps;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-bridge-claim-'));
    spawnFn = vi.fn(() => fakeChild());
    deps = {
      stateDir,
      machineId: 'xian-mac-m4',
      spawnFn,
      randomUUID: () => JOB_ID,
      bridgeToken: BRIDGE_TOKEN,
      brainUrl: BRAIN_URL,
      allowedAccounts: ['team3'],
      codexBin: '/opt/homebrew/bin/codex',
      workDir: stateDir,
      loadAccountAuth: vi.fn(() => ({ tokens: { access_token: 'provider-secret' } })),
      fetchFn: vi.fn(async () => ({ ok: true, status: 200 })),
      sleep: vi.fn(async () => {}),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      runtimeRoot: stateDir,
      ownerPid: 4101,
      ownerProcessIdentity: 'process-4101-start-a',
      readProcessIdentity: vi.fn(pid => (
        pid === 4101 ? 'process-4101-start-a' : null
      )),
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('keeps the same accepted job when another handler proves the owner process is alive', async () => {
    const firstHandler = createKernelAttemptHandler(deps);
    const first = await firstHandler.accept(request(), auth());
    const reloaded = createKernelAttemptHandler(deps);
    const second = await reloaded.accept(request(), auth());

    expect(second.job_id).toBe(first.job_id);
    expect(second.status).toBe('accepted');
    expect(spawnFn).toHaveBeenCalledOnce();
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, `${ATTEMPT_ID}.json`), 'utf8')))
      .toMatchObject({
        attempt_id: ATTEMPT_ID,
        lease_owner: 'dispatcher:test',
        lease_generation: 0,
        job_id: JOB_ID,
        machine_id: 'xian-mac-m4',
        status: 'accepted',
        bridge_instance_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        owner_pid: 4101,
        owner_process_identity: 'process-4101-start-a',
      });
  });

  it('keeps an accepted claim when owner liveness is temporarily unknown', async () => {
    const firstHandler = createKernelAttemptHandler(deps);
    await firstHandler.accept(request(), auth());
    const reloaded = createKernelAttemptHandler({
      ...deps,
      ownerPid: 4102,
      ownerProcessIdentity: 'process-4102-start-b',
      readProcessIdentity: vi.fn(pid => (
        pid === 4102 ? 'process-4102-start-b' : undefined
      )),
    });

    await expect(reloaded.inspect(ATTEMPT_ID, auth())).resolves.toMatchObject({
      status: 'accepted',
      owner_pid: 4101,
      owner_process_identity: 'process-4101-start-a',
    });
    expect(spawnFn).toHaveBeenCalledOnce();
  });

  it('rejects the same attempt with a different lease owner or generation', async () => {
    const handler = createKernelAttemptHandler(deps);
    await handler.accept(request(), auth());

    await expect(handler.accept(request({ lease_owner: 'attacker' }), auth()))
      .rejects.toMatchObject({ message: 'attempt_claim_conflict', statusCode: 409 });
    await expect(handler.accept(request({ lease_generation: 1 }), auth()))
      .rejects.toMatchObject({ message: 'attempt_claim_conflict', statusCode: 409 });
    expect(spawnFn).toHaveBeenCalledOnce();
  });

  it('publishes one winner across concurrent Bridge processes and spawns exactly once', async () => {
    const barrierDir = path.join(stateDir, 'barrier');
    const spawnLog = path.join(stateDir, 'spawns.log');
    fs.mkdirSync(barrierDir);
    const handlerPath = path.resolve(
      process.cwd(),
      'scripts/codex-bridge/kernel-attempt-handler.cjs',
    );

    await Promise.all([
      runClaimWorker({ handlerPath, stateDir, barrierDir, spawnLog, workerId: 1 }),
      runClaimWorker({ handlerPath, stateDir, barrierDir, spawnLog, workerId: 2 }),
    ]);

    expect(fs.readFileSync(spawnLog, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(
      fs.readFileSync(path.join(stateDir, `${ATTEMPT_ID}.json`), 'utf8'),
    )).toMatchObject({
      attempt_id: ATTEMPT_ID,
      status: 'accepted',
    });
  }, 15000);

  it('marks an accepted claim without a live child as a restart orphan after reload', async () => {
    const firstHandler = createKernelAttemptHandler(deps);
    const first = await firstHandler.accept(request(), auth());
    const reloaded = createKernelAttemptHandler({
      ...deps,
      ownerPid: 4102,
      ownerProcessIdentity: 'process-4102-start-b',
      readProcessIdentity: vi.fn(pid => (
        pid === 4102 ? 'process-4102-start-b' : null
      )),
    });

    await expect(reloaded.inspect(ATTEMPT_ID, auth())).resolves.toMatchObject({
      job_id: first.job_id,
      status: 'failed',
      failure_reason: 'bridge_restart_orphaned',
    });
    await expect(reloaded.accept(request(), auth())).resolves.toMatchObject({
      job_id: first.job_id,
      status: 'failed',
    });
    expect(spawnFn).toHaveBeenCalledOnce();
  });
});

describe('kernel attempt security and Codex execution', () => {
  let stateDir;
  let spawnFn;
  let child;
  let fetchFn;
  let logger;
  let deps;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-bridge-security-'));
    child = fakeChild();
    spawnFn = vi.fn(() => child);
    fetchFn = vi.fn(async () => ({ ok: true, status: 200 }));
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    deps = {
      stateDir,
      machineId: 'xian-mac-m4',
      spawnFn,
      randomUUID: () => JOB_ID,
      bridgeToken: BRIDGE_TOKEN,
      brainUrl: BRAIN_URL,
      allowedAccounts: ['team3'],
      codexBin: '/opt/homebrew/bin/codex',
      workDir: stateDir,
      loadAccountAuth: vi.fn(() => ({ tokens: { access_token: 'provider-secret' } })),
      fetchFn,
      sleep: vi.fn(async () => {}),
      logger,
      runtimeRoot: stateDir,
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it.each([
    ['an absent Bearer token', undefined],
    ['a wrong Bearer token', { authorization: 'Bearer wrong-token-that-is-also-long-enough' }],
  ])('rejects %s', async (_case, headers) => {
    const handler = createKernelAttemptHandler(deps);

    await expect(handler.accept(request(), headers))
      .rejects.toMatchObject({ message: 'unauthorized', statusCode: 401 });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('rejects a request targeting a different canonical machine', async () => {
    const handler = createKernelAttemptHandler(deps);

    await expect(handler.accept(request({
      target: { provider: 'codex', account: 'team3', machine: 'xian-mac-m1' },
    }), auth())).rejects.toMatchObject({
      message: 'target_machine_mismatch',
      statusCode: 409,
    });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-Codex provider', {
      provider_spec: { ...request().provider_spec, provider: 'claude' },
    }, 'provider_not_allowed'],
    ['a non-Codex target provider', {
      target: { provider: 'claude', account: 'team3', machine: 'xian-mac-m4' },
    }, 'provider_not_allowed'],
    ['an arbitrary command', {
      provider_spec: { ...request().provider_spec, command: '/bin/sh' },
    }, 'codex_command_not_allowed'],
    ['shell metacharacters', {
      provider_spec: {
        ...request().provider_spec,
        args: [...request().provider_spec.args, '; rm -rf /tmp/nope'],
      },
    }, 'codex_args_not_allowed'],
    ['sandbox bypass', {
      provider_spec: {
        ...request().provider_spec,
        args: [...request().provider_spec.args, '--dangerously-bypass-approvals-and-sandbox'],
      },
    }, 'codex_args_not_allowed'],
    ['a non-allowlisted output path', {
      provider_spec: {
        ...request().provider_spec,
        args: request().provider_spec.args.map(value => value === RESULT_PATH ? '/tmp/stolen.json' : value),
        output: { ...request().provider_spec.output, result_path: '/tmp/stolen.json' },
      },
    }, 'codex_output_path_not_allowed'],
    ['an account outside the local allowlist', {
      target: { provider: 'codex', account: 'team5', machine: 'xian-mac-m4' },
    }, 'codex_account_not_allowed'],
    ['a callback outside the configured Brain origin', {
      callback_url: `https://attacker.example/api/brain/harness/attempts/${ATTEMPT_ID}/callback`,
    }, 'callback_url_not_allowed'],
  ])('rejects %s before creating a claim', async (_case, override, errorCode) => {
    const handler = createKernelAttemptHandler(deps);

    await expect(handler.accept(request(override), auth()))
      .rejects.toMatchObject({ message: errorCode, statusCode: 422 });
    expect(spawnFn).not.toHaveBeenCalled();
    expect(fs.readdirSync(stateDir)).toEqual([]);
  });

  it.each([
    ['an arbitrary cwd', {
      kind: 'disposable-canary-v1',
      attempt_id: ATTEMPT_ID,
      cwd: '/Users/operator/repos/cecelia',
    }],
    ['an arbitrary path', {
      kind: 'disposable-canary-v1',
      attempt_id: ATTEMPT_ID,
      path: '/Users/operator/repos/cecelia',
    }],
    ['the real repository as a workspace string', '/Users/operator/repos/cecelia'],
    ['an unknown workspace kind', {
      kind: 'real-repository',
      attempt_id: ATTEMPT_ID,
    }],
    ['a different Attempt identity', {
      kind: 'disposable-canary-v1',
      attempt_id: '99999999-9999-4999-8999-999999999999',
    }],
  ])('rejects %s instead of spawning in a client-selected directory', async (_case, workspace) => {
    const handler = createKernelAttemptHandler(deps);

    await expect(handler.accept(request({
      provider_spec: {
        ...request().provider_spec,
        workspace,
      },
    }), auth())).rejects.toMatchObject({
      message: 'disposable_workspace_not_allowed',
      statusCode: 422,
    });
    expect(spawnFn).not.toHaveBeenCalled();
    expect(fs.readdirSync(stateDir)).toEqual([]);
  });

  it('runs a legal canary in a Bridge-owned disposable workspace', async () => {
    vi.stubEnv('BRAIN_URL', 'https://must-not-reach-provider.example');
    vi.stubEnv('KERNEL_BRIDGE_TOKEN_FILE', '/must/not/reach/provider');
    vi.stubEnv('KERNEL_BRIDGE_STATE_DIR', '/must/not/reach/provider-state');
    const fixedWorkDir = path.join(stateDir, 'real-repository');
    fs.mkdirSync(fixedWorkDir);
    const handler = createKernelAttemptHandler({
      ...deps,
      workDir: fixedWorkDir,
    });

    await handler.accept(request({
      provider_spec: canaryProviderSpec(),
    }), auth());

    const spawnedCwd = spawnFn.mock.calls[0][2].cwd;
    expect(spawnedCwd).not.toBe(fixedWorkDir);
    expect(path.relative(stateDir, spawnedCwd)).toMatch(
      /^kernel-bridge-[^/]+-[^/]+\/workspace$/,
    );
    expect(fs.statSync(spawnedCwd).mode & 0o777).toBe(0o700);
    expect(spawnFn.mock.calls[0][1]).toEqual(expect.arrayContaining([
      '--disable', 'shell_tool',
      '--disable', 'unified_exec',
      '--disable', 'computer_use',
      '--disable', 'in_app_browser',
      '--disable', 'multi_agent',
      '--disable', 'multi_agent_v2',
      '--disable', 'hooks',
      '--disable', 'goals',
      '--ignore-user-config',
    ]));
    expect(spawnFn.mock.calls[0][2].env).not.toHaveProperty('BRAIN_URL');
    expect(spawnFn.mock.calls[0][2].env).not.toHaveProperty('KERNEL_BRIDGE_TOKEN_FILE');
    expect(spawnFn.mock.calls[0][2].env).not.toHaveProperty('KERNEL_BRIDGE_STATE_DIR');
    const args = spawnFn.mock.calls[0][1];
    const schemaPath = args[args.indexOf('--output-schema') + 1];
    expectOpenAiStrictSchema(JSON.parse(fs.readFileSync(schemaPath, 'utf8')));
  });

  it('fails closed when a disposable workspace cannot be created', async () => {
    const createDisposableWorkspace = vi.fn(() => {
      throw new Error('workspace_create_denied');
    });
    const handler = createKernelAttemptHandler({
      ...deps,
      createDisposableWorkspace,
    });

    await expect(handler.accept(request({
      provider_spec: canaryProviderSpec(),
    }), auth())).rejects.toMatchObject({
      message: 'provider_start_failed',
      statusCode: 503,
    });
    expect(createDisposableWorkspace).toHaveBeenCalledOnce();
    expect(spawnFn).not.toHaveBeenCalled();
    expect(JSON.parse(
      fs.readFileSync(path.join(stateDir, `${ATTEMPT_ID}.json`), 'utf8'),
    )).toMatchObject({ status: 'failed' });
  });

  it('runs frozen Codex arguments in an isolated account home and normalizes the callback', async () => {
    const handler = createKernelAttemptHandler(deps);
    const receipt = await handler.accept(request(), auth());
    const [, args, options] = spawnFn.mock.calls[0];
    const resultPath = args[args.indexOf('--output-last-message') + 1];
    const authMode = fs.statSync(path.join(options.env.CODEX_HOME, 'auth.json')).mode & 0o777;
    fs.writeFileSync(resultPath, JSON.stringify({
      contract_version: '1.0',
      attempt_id: '99999999-9999-4999-8999-999999999999',
      status: 'completed',
      summary: 'done',
      artifacts: [],
      checks: [],
      decision: null,
      error: null,
      provider_metadata: { provider: 'untrusted', session_id: 'thread-1' },
    }));

    child.emit('close', 0);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

    expect(receipt).toMatchObject({
      actual_machine_id: 'xian-mac-m4',
      job_id: JOB_ID,
      status: 'accepted',
      attestation: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(spawnFn).toHaveBeenCalledWith(
      '/opt/homebrew/bin/codex',
      [
        'exec',
        '--json',
        '--output-schema', expect.stringContaining('.schema.json'),
        '--output-last-message', expect.stringContaining('.result.json'),
        '--skip-git-repo-check',
        '-',
      ],
      expect.objectContaining({
        cwd: stateDir,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
    expect(options.env.CODEX_HOME).toContain('codex-home');
    expect(authMode).toBe(0o600);
    expect(child.stdin.end).toHaveBeenCalledWith(request().provider_spec.stdin);
    expect(child.stdout.listenerCount('data')).toBeGreaterThan(0);
    expect(child.stderr.listenerCount('data')).toBeGreaterThan(0);

    const [callbackUrl, callbackOptions] = fetchFn.mock.calls[0];
    const callback = JSON.parse(callbackOptions.body);
    expect(callbackUrl).toBe(request().callback_url);
    expect(callback.attempt_id).toBe(ATTEMPT_ID);
    expect(callback.provider_metadata).toMatchObject({
      provider: 'codex',
      machine_id: 'xian-mac-m4',
      remote_job_id: JOB_ID,
      machine_attestation: receipt.attestation,
    });
    expect(callbackOptions.headers).toMatchObject({
      Authorization: `Bearer ${CALLBACK_TOKEN}`,
      'X-Harness-Lease-Owner': 'dispatcher:test',
    });
    expect(callbackOptions.redirect).toBe('error');
    expect(callbackOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it('never persists or logs the per-attempt callback token', async () => {
    const handler = createKernelAttemptHandler(deps);
    await handler.accept(request(), auth());

    const persisted = fs.readFileSync(path.join(stateDir, `${ATTEMPT_ID}.json`), 'utf8');
    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(persisted).not.toContain(CALLBACK_TOKEN);
    expect(logged).not.toContain(CALLBACK_TOKEN);
  });

  it('turns an invalid provider result into a failed Harness callback', async () => {
    const handler = createKernelAttemptHandler(deps);
    await handler.accept(request(), auth());
    const args = spawnFn.mock.calls[0][1];
    const resultPath = args[args.indexOf('--output-last-message') + 1];
    fs.writeFileSync(resultPath, JSON.stringify({
      contract_version: '1.0',
      attempt_id: ATTEMPT_ID,
      status: 'not-a-harness-status',
      summary: 'untrusted',
      provider_metadata: { provider: 'codex' },
    }));

    child.emit('close', 0);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toMatchObject({
      status: 'failed',
      error: { code: 'provider_result_invalid' },
    });
  });

  it('persists a failed claim and cleans runtime files when provider startup throws', async () => {
    deps.loadAccountAuth.mockImplementationOnce(() => {
      throw new Error(`provider auth unavailable ${CALLBACK_TOKEN}`);
    });
    const handler = createKernelAttemptHandler(deps);

    await expect(handler.accept(request(), auth()))
      .rejects.toMatchObject({ message: 'provider_start_failed', statusCode: 503 });
    await expect(handler.inspect(ATTEMPT_ID, auth())).resolves.toMatchObject({
      status: 'failed',
      job_id: JOB_ID,
    });
    expect(fs.readdirSync(stateDir)).toEqual([`${ATTEMPT_ID}.json`]);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(CALLBACK_TOKEN);
  });

  it('retries callback delivery without spawning a second provider process', async () => {
    fetchFn
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const handler = createKernelAttemptHandler(deps);
    await handler.accept(request(), auth());
    const args = spawnFn.mock.calls[0][1];
    const resultPath = args[args.indexOf('--output-last-message') + 1];
    fs.writeFileSync(resultPath, JSON.stringify({
      contract_version: '1.0',
      attempt_id: ATTEMPT_ID,
      status: 'completed',
      summary: 'done',
      artifacts: [],
      checks: [],
      decision: null,
      error: null,
      provider_metadata: { provider: 'codex' },
    }));

    child.emit('close', 0);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));

    expect(spawnFn).toHaveBeenCalledOnce();
    expect(deps.sleep).toHaveBeenCalledOnce();
  });

  it('persists exhausted callback delivery and redelivers after reload without respawning', async () => {
    fetchFn.mockResolvedValue({ ok: false, status: 503 });
    const handler = createKernelAttemptHandler(deps);
    const receipt = await handler.accept(request(), auth());
    const args = spawnFn.mock.calls[0][1];
    const resultPath = args[args.indexOf('--output-last-message') + 1];
    fs.writeFileSync(resultPath, JSON.stringify({
      contract_version: '1.0',
      attempt_id: ATTEMPT_ID,
      status: 'completed',
      summary: 'callback needs redelivery',
      artifacts: [],
      checks: [],
      decision: null,
      error: null,
      provider_metadata: { provider: 'codex' },
    }));
    child.emit('close', 0);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(3));

    await expect(handler.inspect(ATTEMPT_ID, auth())).resolves.toMatchObject({
      job_id: receipt.job_id,
      status: 'callback_pending',
      provider_status: 'completed',
      callback_delivery: 'failed',
      callback_result: expect.objectContaining({
        attempt_id: ATTEMPT_ID,
        summary: 'callback needs redelivery',
      }),
    });
    expect(fs.readFileSync(path.join(stateDir, `${ATTEMPT_ID}.json`), 'utf8'))
      .not.toContain(CALLBACK_TOKEN);

    fetchFn.mockReset().mockResolvedValue({ ok: true, status: 200 });
    const reloaded = createKernelAttemptHandler(deps);
    await expect(reloaded.accept(request(), auth())).resolves.toMatchObject({
      job_id: receipt.job_id,
      status: 'accepted',
    });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

    await expect(reloaded.inspect(ATTEMPT_ID, auth())).resolves.toMatchObject({
      status: 'completed',
      callback_delivery: 'delivered',
    });
    expect(spawnFn).toHaveBeenCalledOnce();
    const persisted = fs.readFileSync(path.join(stateDir, `${ATTEMPT_ID}.json`), 'utf8');
    expect(persisted).not.toContain(CALLBACK_TOKEN);
    expect(persisted).not.toContain('callback_result');
  });

  it('does not let a peer handler take over callback delivery while the owner is alive', async () => {
    let resolveOwnerCallback;
    const ownerCallback = new Promise(resolve => {
      resolveOwnerCallback = resolve;
    });
    const ownerFetch = vi.fn(() => ownerCallback);
    const owner = createKernelAttemptHandler({ ...deps, fetchFn: ownerFetch });
    await owner.accept(request(), auth());
    const args = spawnFn.mock.calls[0][1];
    const resultPath = args[args.indexOf('--output-last-message') + 1];
    fs.writeFileSync(resultPath, JSON.stringify({
      contract_version: '1.0',
      attempt_id: ATTEMPT_ID,
      status: 'completed',
      summary: 'owner callback pending',
      artifacts: [],
      checks: [],
      decision: null,
      error: null,
      provider_metadata: { provider: 'codex' },
    }));
    child.emit('close', 0);
    await vi.waitFor(() => expect(ownerFetch).toHaveBeenCalledOnce());

    await expect(owner.inspect(ATTEMPT_ID, auth())).resolves.toMatchObject({
      status: 'completed',
      callback_delivery: 'pending',
      callback_delivery_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      callback_owner_instance_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      callback_owner_pid: process.pid,
      callback_result: expect.objectContaining({ summary: 'owner callback pending' }),
    });
    const peerFetch = vi.fn(async () => ({ ok: false, status: 503 }));
    const peer = createKernelAttemptHandler({ ...deps, fetchFn: peerFetch });
    await peer.accept(request(), auth());

    await expect(owner.inspect(ATTEMPT_ID, auth())).resolves.toMatchObject({
      status: 'completed',
      callback_delivery: 'pending',
      callback_result: expect.objectContaining({ summary: 'owner callback pending' }),
    });
    expect(peerFetch).not.toHaveBeenCalled();

    resolveOwnerCallback({ ok: true, status: 200 });
    await vi.waitFor(async () => {
      await expect(owner.inspect(ATTEMPT_ID, auth())).resolves.toMatchObject({
        status: 'completed',
        callback_delivery: 'delivered',
      });
    });
    const persisted = fs.readFileSync(path.join(stateDir, `${ATTEMPT_ID}.json`), 'utf8');
    expect(persisted).not.toContain('callback_result');
    expect(persisted).not.toContain('callback_delivery_id');
    expect(persisted).not.toContain('callback_owner_instance_id');
    expect(persisted).not.toContain(CALLBACK_TOKEN);
    expect(spawnFn).toHaveBeenCalledOnce();
  });

  it('allows only one persisted callback owner across competing reload handlers', async () => {
    fetchFn.mockResolvedValue({ ok: false, status: 503 });
    const owner = createKernelAttemptHandler(deps);
    await owner.accept(request(), auth());
    const args = spawnFn.mock.calls[0][1];
    const resultPath = args[args.indexOf('--output-last-message') + 1];
    fs.writeFileSync(resultPath, JSON.stringify({
      contract_version: '1.0',
      attempt_id: ATTEMPT_ID,
      status: 'completed',
      summary: 'one redelivery owner',
      artifacts: [],
      checks: [],
      decision: null,
      error: null,
      provider_metadata: { provider: 'codex' },
    }));
    child.emit('close', 0);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(3));

    let resolveFirst;
    let resolveSecond;
    const firstFetch = vi.fn(() => new Promise(resolve => {
      resolveFirst = resolve;
    }));
    const secondFetch = vi.fn(() => new Promise(resolve => {
      resolveSecond = resolve;
    }));
    const firstReload = createKernelAttemptHandler({ ...deps, fetchFn: firstFetch });
    const secondReload = createKernelAttemptHandler({ ...deps, fetchFn: secondFetch });

    await firstReload.accept(request(), auth());
    await secondReload.accept(request(), auth());
    expect(firstFetch.mock.calls.length + secondFetch.mock.calls.length).toBe(1);
    await expect(firstReload.inspect(ATTEMPT_ID, auth())).resolves.toMatchObject({
      status: 'callback_pending',
      callback_delivery: 'pending',
      callback_delivery_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      callback_owner_instance_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    });

    resolveFirst?.({ ok: true, status: 200 });
    resolveSecond?.({ ok: true, status: 200 });
    await vi.waitFor(async () => {
      await expect(firstReload.inspect(ATTEMPT_ID, auth())).resolves.toMatchObject({
        status: 'completed',
        callback_delivery: 'delivered',
      });
    });
    expect(spawnFn).toHaveBeenCalledOnce();
  });

  it('does not let stale restart reconciliation erase a newer callback owner generation', async () => {
    const barrierDir = path.join(stateDir, 'callback-reconcile-barrier');
    const resultPath = path.join(barrierDir, 'owner-result.json');
    fs.mkdirSync(barrierDir);
    fs.writeFileSync(path.join(stateDir, `${ATTEMPT_ID}.json`), JSON.stringify({
      attempt_id: ATTEMPT_ID,
      lease_owner: request().lease_owner,
      lease_generation: request().lease_generation,
      job_id: JOB_ID,
      machine_id: 'xian-mac-m4',
      status: 'callback_pending',
      provider_status: 'completed',
      callback_delivery: 'pending',
      callback_delivery_id: '66666666-6666-4666-8666-666666666666',
      callback_owner_instance_id: '77777777-7777-4777-8777-777777777777',
      callback_owner_pid: 2147483647,
      callback_owner_process_identity: 'dead-owner-process',
      callback_url: request().callback_url,
      callback_result: {
        contract_version: '1.0',
        attempt_id: ATTEMPT_ID,
        status: 'completed',
        summary: 'restart reconciliation race',
        artifacts: [],
        checks: [],
        decision: null,
        error: null,
        provider_metadata: { provider: 'codex' },
      },
    }));
    const handlerPath = require.resolve(
      '../../scripts/codex-bridge/kernel-attempt-handler.cjs',
    );

    await Promise.all([
      runCallbackReconcileWorker({
        handlerPath,
        stateDir,
        barrierDir,
        resultPath,
        role: 'reconciler',
      }),
      runCallbackReconcileWorker({
        handlerPath,
        stateDir,
        barrierDir,
        resultPath,
        role: 'owner',
      }),
    ]);

    const capturedClaim = JSON.parse(fs.readFileSync(`${resultPath}.captured`, 'utf8'));
    expect(capturedClaim).toMatchObject({
      status: 'callback_pending',
      callback_delivery: 'pending',
      callback_delivery_id: '66666666-6666-4666-8666-666666666666',
      callback_owner_instance_id: '77777777-7777-4777-8777-777777777777',
    });
    const reconcilerClaim = JSON.parse(fs.readFileSync(`${resultPath}.reconciler`, 'utf8'));
    expect(reconcilerClaim).toMatchObject({
      attempt_id: ATTEMPT_ID,
      status: 'callback_pending',
      callback_delivery: 'pending',
      callback_delivery_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      callback_owner_instance_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    });
    const finalClaim = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    expect(finalClaim).toMatchObject({
      attempt_id: ATTEMPT_ID,
      status: 'completed',
      callback_delivery: 'delivered',
    });
    expect(finalClaim).not.toHaveProperty('callback_result');
    expect(finalClaim).not.toHaveProperty('callback_delivery_id');
    expect(fs.existsSync(`${path.join(stateDir, `${ATTEMPT_ID}.json`)}.callback-owner`))
      .toBe(false);
  });

  it('drains large provider stdout and stderr so process close remains reachable', async () => {
    child.stdout = new PassThrough({ highWaterMark: 1024 });
    child.stderr = new PassThrough({ highWaterMark: 1024 });
    const handler = createKernelAttemptHandler(deps);
    await handler.accept(request(), auth());
    const args = spawnFn.mock.calls[0][1];
    const resultPath = args[args.indexOf('--output-last-message') + 1];
    fs.writeFileSync(resultPath, JSON.stringify({
      contract_version: '1.0',
      attempt_id: ATTEMPT_ID,
      status: 'completed',
      summary: 'large output drained',
      artifacts: [],
      checks: [],
      decision: null,
      error: null,
      provider_metadata: { provider: 'codex' },
    }));

    const writeMegabyte = async (stream, byte) => {
      const chunk = Buffer.alloc(16 * 1024, byte);
      for (let index = 0; index < 64; index += 1) {
        if (!stream.write(chunk)) await once(stream, 'drain');
      }
      stream.end();
    };
    await Promise.all([
      writeMegabyte(child.stdout, 65),
      writeMegabyte(child.stderr, 66),
    ]);
    child.emit('close', 0);

    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchFn.mock.calls[0][1].body))
      .toMatchObject({ status: 'completed', summary: 'large output drained' });
  });

  it('accepts a real codexAdapter resume spec and rebuilds its allowlisted args', async () => {
    const resumeSpec = codexAdapter.resume({
      attempt: {
        id: ATTEMPT_ID,
        provider: 'codex',
        provider_session_id: SESSION_ID,
        task_bundle: {
          attempt_id: ATTEMPT_ID,
          objective: 'continue safely',
          inputs: { worktree_path: stateDir },
        },
      },
      input: 'continue',
      execution: {
        resultSchemaPath: SCHEMA_PATH,
        resultPath: RESULT_PATH,
      },
    });
    const handler = createKernelAttemptHandler(deps);

    await expect(handler.accept(request({ provider_spec: resumeSpec }), auth()))
      .resolves.toMatchObject({ status: 'accepted' });
    expect(spawnFn.mock.calls[0][1]).toEqual([
      'exec',
      'resume',
      SESSION_ID,
      '--json',
      '--output-schema', expect.stringContaining('.schema.json'),
      '--output-last-message', expect.stringContaining('.result.json'),
      '--skip-git-repo-check',
      '-',
    ]);
  });

  it('rejects resume specs with invalid session IDs or extra arguments', async () => {
    const baseArgs = [
      'exec',
      'resume',
      SESSION_ID,
      '--json',
      '--output-schema', SCHEMA_PATH,
      '--output-last-message', RESULT_PATH,
      '--skip-git-repo-check',
      '-',
    ];
    const handler = createKernelAttemptHandler(deps);

    await expect(handler.accept(request({
      provider_spec: {
        ...request().provider_spec,
        args: baseArgs.map(value => value === SESSION_ID ? '$(touch /tmp/pwned)' : value),
      },
    }), auth())).rejects.toMatchObject({
      message: 'codex_resume_session_not_allowed',
      statusCode: 422,
    });
    await expect(handler.accept(request({
      provider_spec: {
        ...request().provider_spec,
        args: [...baseArgs, '--model', 'attacker-model'],
      },
    }), auth())).rejects.toMatchObject({
      message: 'codex_args_not_allowed',
      statusCode: 422,
    });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('inspects persisted terminal state after the provider exits', async () => {
    const handler = createKernelAttemptHandler(deps);
    await handler.accept(request(), auth());
    const accepted = await handler.inspect(ATTEMPT_ID, auth());
    const args = spawnFn.mock.calls[0][1];
    const resultPath = args[args.indexOf('--output-last-message') + 1];
    fs.writeFileSync(resultPath, JSON.stringify({
      contract_version: '1.0',
      attempt_id: ATTEMPT_ID,
      status: 'completed',
      summary: 'done',
      artifacts: [],
      checks: [],
      decision: null,
      error: null,
      provider_metadata: { provider: 'codex' },
    }));
    child.emit('close', 0);

    await vi.waitFor(async () => {
      await expect(handler.inspect(ATTEMPT_ID, auth()))
        .resolves.toMatchObject({ status: 'completed' });
    });
    expect(accepted).toMatchObject({
      attempt_id: ATTEMPT_ID,
      job_id: JOB_ID,
      status: 'accepted',
    });
    await expect(handler.inspect(ATTEMPT_ID, auth()))
      .resolves.not.toMatchObject({ status: 'accepted' });
  });

  it('lease-fences cancellation, terminates the live child and makes repeat cancellation idempotent', async () => {
    const handler = createKernelAttemptHandler(deps);
    await handler.accept(request(), auth());

    await expect(handler.cancel(ATTEMPT_ID, {
      lease_owner: 'attacker',
      lease_generation: 0,
    }, auth())).rejects.toMatchObject({
      message: 'attempt_claim_conflict',
      statusCode: 409,
    });
    await expect(handler.cancel(ATTEMPT_ID, {
      lease_owner: 'dispatcher:test',
      lease_generation: 1,
    }, auth())).rejects.toMatchObject({
      message: 'attempt_claim_conflict',
      statusCode: 409,
    });
    expect(child.kill).not.toHaveBeenCalled();

    await expect(handler.cancel(ATTEMPT_ID, {
      lease_owner: 'dispatcher:test',
      lease_generation: 0,
    }, auth())).resolves.toMatchObject({ status: 'cancelled' });
    expect(child.kill.mock.calls.map(([signal]) => signal))
      .toEqual(['SIGTERM', 'SIGKILL']);
    await expect(handler.inspect(ATTEMPT_ID, auth()))
      .resolves.toMatchObject({ status: 'cancelled' });

    await handler.cancel(ATTEMPT_ID, {
      lease_owner: 'dispatcher:test',
      lease_generation: 0,
    }, auth());
    expect(child.kill).toHaveBeenCalledTimes(2);
  });

  it('does not rewrite a completed claim when cancellation arrives after process exit', async () => {
    const handler = createKernelAttemptHandler(deps);
    await handler.accept(request(), auth());
    const args = spawnFn.mock.calls[0][1];
    const resultPath = args[args.indexOf('--output-last-message') + 1];
    fs.writeFileSync(resultPath, JSON.stringify({
      contract_version: '1.0',
      attempt_id: ATTEMPT_ID,
      status: 'completed',
      summary: 'done',
      artifacts: [],
      checks: [],
      decision: null,
      error: null,
      provider_metadata: { provider: 'codex' },
    }));
    child.emit('close', 0);
    await vi.waitFor(async () => {
      await expect(handler.inspect(ATTEMPT_ID, auth()))
        .resolves.toMatchObject({ status: 'completed' });
    });

    await expect(handler.cancel(ATTEMPT_ID, {
      lease_owner: 'dispatcher:test',
      lease_generation: 0,
    }, auth())).resolves.toMatchObject({ status: 'completed' });
    await expect(handler.inspect(ATTEMPT_ID, auth()))
      .resolves.toMatchObject({ status: 'completed' });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('does not rewrite a failed claim when cancellation arrives after process exit', async () => {
    const handler = createKernelAttemptHandler(deps);
    await handler.accept(request(), auth());
    child.emit('close', 23);
    await vi.waitFor(async () => {
      await expect(handler.inspect(ATTEMPT_ID, auth()))
        .resolves.toMatchObject({ status: 'failed' });
    });

    await expect(handler.cancel(ATTEMPT_ID, {
      lease_owner: 'dispatcher:test',
      lease_generation: 0,
    }, auth())).resolves.toMatchObject({ status: 'failed' });
    await expect(handler.inspect(ATTEMPT_ID, auth()))
      .resolves.toMatchObject({ status: 'failed' });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('records cancel intent before SIGTERM so a synchronous close reports cancelled once', async () => {
    child.kill.mockImplementationOnce(signal => {
      expect(signal).toBe('SIGTERM');
      child.emit('close', null, 'SIGTERM');
    });
    const handler = createKernelAttemptHandler(deps);
    await handler.accept(request(), auth());

    await expect(handler.cancel(ATTEMPT_ID, {
      lease_owner: 'dispatcher:test',
      lease_generation: 0,
    }, auth())).resolves.toMatchObject({ status: 'cancelled' });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

    expect(child.kill).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchFn.mock.calls[0][1].body))
      .toMatchObject({ status: 'cancelled' });
    await expect(handler.inspect(ATTEMPT_ID, auth()))
      .resolves.toMatchObject({ status: 'cancelled' });
  });

  it('rejects non-owner cancellation without changing state, then lets the owner cancel', async () => {
    child.kill.mockImplementationOnce(signal => {
      expect(signal).toBe('SIGTERM');
      child.emit('close', null, 'SIGTERM');
    });
    const owner = createKernelAttemptHandler(deps);
    const peer = createKernelAttemptHandler(deps);
    await owner.accept(request(), auth());

    await expect(peer.cancel(ATTEMPT_ID, {
      lease_owner: 'dispatcher:test',
      lease_generation: 0,
    }, auth())).rejects.toMatchObject({
      message: 'owner_process_mismatch',
      statusCode: 409,
    });
    await expect(owner.inspect(ATTEMPT_ID, auth()))
      .resolves.toMatchObject({ status: 'accepted' });
    expect(child.kill).not.toHaveBeenCalled();

    await expect(owner.cancel(ATTEMPT_ID, {
      lease_owner: 'dispatcher:test',
      lease_generation: 0,
    }, auth())).resolves.toMatchObject({ status: 'cancelled' });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

    expect(child.kill).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchFn.mock.calls[0][1].body))
      .toMatchObject({ status: 'cancelled' });
    await expect(owner.inspect(ATTEMPT_ID, auth()))
      .resolves.toMatchObject({ status: 'cancelled' });
  });

  it('never lets a stale provider close overwrite a persisted cancelled terminal state', async () => {
    const handler = createKernelAttemptHandler(deps);
    await handler.accept(request(), auth());
    const args = spawnFn.mock.calls[0][1];
    const resultPath = args[args.indexOf('--output-last-message') + 1];
    fs.writeFileSync(resultPath, JSON.stringify({
      contract_version: '1.0',
      attempt_id: ATTEMPT_ID,
      status: 'completed',
      summary: 'must not overwrite cancellation',
      artifacts: [],
      checks: [],
      decision: null,
      error: null,
      provider_metadata: { provider: 'codex' },
    }));
    const claimPath = path.join(stateDir, `${ATTEMPT_ID}.json`);
    const claim = JSON.parse(fs.readFileSync(claimPath, 'utf8'));
    fs.writeFileSync(claimPath, `${JSON.stringify({ ...claim, status: 'cancelled' })}\n`);

    child.emit('close', 0);
    await new Promise(resolve => setImmediate(resolve));

    await expect(handler.inspect(ATTEMPT_ID, auth()))
      .resolves.toMatchObject({ status: 'cancelled' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

});

describe('kernel attempt HTTP routes', () => {
  it('mounts launch, inspect and cancel with authenticated request context', async () => {
    const kernelHandler = {
      accept: vi.fn(async () => ({
        actual_machine_id: 'xian-mac-m4',
        job_id: JOB_ID,
        status: 'accepted',
        attestation: 'a'.repeat(64),
      })),
      inspect: vi.fn(async () => ({
        attempt_id: ATTEMPT_ID,
        status: 'accepted',
      })),
      cancel: vi.fn(async () => ({
        attempt_id: ATTEMPT_ID,
        status: 'cancelled',
      })),
    };
    const server = createBridgeServer({
      kernelHandler,
      kernelMachineId: 'xian-mac-m4',
    });
    const baseUrl = await listen(server);
    try {
      const launch = await fetch(`${baseUrl}/harness/attempts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${BRIDGE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request()),
      });
      expect(launch.status).toBe(202);
      await expect(launch.json()).resolves.toMatchObject({
        actual_machine_id: 'xian-mac-m4',
        status: 'accepted',
      });
      expect(kernelHandler.accept).toHaveBeenCalledWith(
        expect.objectContaining({ attempt_id: ATTEMPT_ID }),
        { authorization: `Bearer ${BRIDGE_TOKEN}` },
      );

      const inspect = await fetch(`${baseUrl}/harness/attempts/${ATTEMPT_ID}`, {
        headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` },
      });
      expect(inspect.status).toBe(200);
      expect(kernelHandler.inspect).toHaveBeenCalledWith(
        ATTEMPT_ID,
        { authorization: `Bearer ${BRIDGE_TOKEN}` },
      );

      const cancelResponse = await fetch(
        `${baseUrl}/harness/attempts/${ATTEMPT_ID}/cancel`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${BRIDGE_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            lease_owner: 'dispatcher:test',
            lease_generation: 0,
          }),
        },
      );
      expect(cancelResponse.status).toBe(200);
      expect(kernelHandler.cancel).toHaveBeenCalledWith(
        ATTEMPT_ID,
        { lease_owner: 'dispatcher:test', lease_generation: 0 },
        { authorization: `Bearer ${BRIDGE_TOKEN}` },
      );
    } finally {
      await close(server);
    }
  });

  it('rejects an unauthenticated oversized body before parsing it', async () => {
    const unauthorized = Object.assign(new Error('unauthorized'), { statusCode: 401 });
    const kernelHandler = {
      authorize: vi.fn(() => { throw unauthorized; }),
      accept: vi.fn(),
    };
    const server = createBridgeServer({
      kernelHandler,
      kernelMachineId: 'xian-mac-m4',
    });
    const baseUrl = await listen(server);
    try {
      const response = await fetch(`${baseUrl}/harness/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: 'x'.repeat(1024 * 1024 + 1) }),
      });

      expect(response.status).toBe(401);
      expect(kernelHandler.authorize).toHaveBeenCalledOnce();
      expect(kernelHandler.accept).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('returns 413 for an authenticated Harness body over the strict byte limit', async () => {
    const kernelHandler = {
      authorize: vi.fn(),
      accept: vi.fn(async () => ({ status: 'accepted' })),
    };
    const server = createBridgeServer({
      kernelHandler,
      kernelMachineId: 'xian-mac-m4',
    });
    const baseUrl = await listen(server);
    try {
      const response = await fetch(`${baseUrl}/harness/attempts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${BRIDGE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ payload: 'x'.repeat(1024 * 1024 + 1) }),
      });

      expect(response.status).toBe(413);
      expect(kernelHandler.authorize).toHaveBeenCalledOnce();
      expect(kernelHandler.accept).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });
});
