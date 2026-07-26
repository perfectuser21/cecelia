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
import { codexAdapter } from '../orchestrator/providers/codex.js';

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
    };
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('returns the same job for the same attempt and lease generation after reload', async () => {
    const firstHandler = createKernelAttemptHandler(deps);
    const first = await firstHandler.accept(request(), auth());
    const reloaded = createKernelAttemptHandler(deps);
    const second = await reloaded.accept(request(), auth());

    expect(second.job_id).toBe(first.job_id);
    expect(spawnFn).toHaveBeenCalledOnce();
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, `${ATTEMPT_ID}.json`), 'utf8')))
      .toMatchObject({
        attempt_id: ATTEMPT_ID,
        lease_owner: 'dispatcher:test',
        lease_generation: 0,
        job_id: JOB_ID,
        machine_id: 'xian-mac-m4',
        status: 'failed',
        failure_reason: 'bridge_restart_orphaned',
      });
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
    const reloaded = createKernelAttemptHandler(deps);

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
});
