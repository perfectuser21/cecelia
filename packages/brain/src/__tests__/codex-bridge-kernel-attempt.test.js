import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createKernelAttemptHandler } from '../../scripts/codex-bridge/kernel-attempt-handler.cjs';

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';

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
      args: [],
      stdin: '{"task_bundle":{}}',
      output: {},
    },
    callback_url: 'https://brain.example/api/brain/harness/attempts/callback',
    callback_token: 'callback-secret',
    ...overrides,
  };
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
    };
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('returns the same job for the same attempt and lease generation after reload', async () => {
    const firstHandler = createKernelAttemptHandler(deps);
    const first = await firstHandler.accept(request());
    const reloaded = createKernelAttemptHandler(deps);
    const second = await reloaded.accept(request());

    expect(second.job_id).toBe(first.job_id);
    expect(spawnFn).toHaveBeenCalledOnce();
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, `${ATTEMPT_ID}.json`), 'utf8')))
      .toMatchObject({
        attempt_id: ATTEMPT_ID,
        lease_owner: 'dispatcher:test',
        lease_generation: 0,
        job_id: JOB_ID,
        machine_id: 'xian-mac-m4',
        status: 'accepted',
      });
  });

  it('rejects the same attempt with a different lease owner or generation', async () => {
    const handler = createKernelAttemptHandler(deps);
    await handler.accept(request());

    await expect(handler.accept(request({ lease_owner: 'attacker' })))
      .rejects.toMatchObject({ message: 'attempt_claim_conflict', statusCode: 409 });
    await expect(handler.accept(request({ lease_generation: 1 })))
      .rejects.toMatchObject({ message: 'attempt_claim_conflict', statusCode: 409 });
    expect(spawnFn).toHaveBeenCalledOnce();
  });
});
