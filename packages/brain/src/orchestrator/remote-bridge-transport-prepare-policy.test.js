import { describe, expect, it, vi } from 'vitest';
import { signMachineAttestation } from './machine-attestation.js';
import {
  SHARED_SECRET,
  CALLBACK_TOKEN,
  BRIDGE_URL,
  MACHINE,
  ENVELOPE,
  GITHUB_ENVELOPE,
  jsonResponse,
  prepareInput,
  acceptedPrepareResponse,
  createTransport
} from './remote-bridge-transport.fixture.js';

describe('remote Bridge prepare policy', () => {
  it('binds one Codex credential envelope to the selected attempt, account, machine, and deadline', async () => {
    const issue = vi.fn(async () => ENVELOPE);
    const transport = createTransport({ credentialBroker: { issue } });

    await transport.prepare(prepareInput());

    expect(issue).toHaveBeenCalledOnce();
    expect(issue).toHaveBeenCalledWith({
        repo:'perfectuser21/cecelia',provider:'codex',
      attemptId: 'attempt-1',
      accountId: 'team3',
      machineId: MACHINE,
      deadlineAt: '2026-07-27T13:00:00.000Z',
    });
  });

  it('does not issue a Provider credential to the trusted publisher transport', async () => {
    const providerIssue = vi.fn(async () => ENVELOPE);
    const githubIssue = vi.fn(async () => GITHUB_ENVELOPE);
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({
      fetchFn,
      credentialBroker: { issue: providerIssue },
      githubCredentialBroker: { issue: githubIssue },
    });

    await transport.prepare(prepareInput({
      bundle: {
        role: 'publisher',
        inputs: prepareInput().bundle.inputs,
        constraints: { timeout_seconds: 3600 },
      },
    }));

    expect(providerIssue).not.toHaveBeenCalled();
    expect(githubIssue).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchFn.mock.calls[0][1].body))
      .not.toHaveProperty('credential_envelope');
  });

  it.each(['planner', 'proposer', 'evaluator', 'publisher'])(
    'binds one GitHub credential envelope to a %s Attempt and deadline',
    async (role) => {
      const issue = vi.fn(async () => GITHUB_ENVELOPE);
      const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
      const transport = createTransport({
        fetchFn,
        githubCredentialBroker: { issue },
      });

      await transport.prepare(prepareInput({
        bundle: {
          role,
          inputs: prepareInput().bundle.inputs,
          constraints: { timeout_seconds: 3600 },
        },
      }));

      expect(issue).toHaveBeenCalledOnce();
      expect(issue).toHaveBeenCalledWith({
        repo:'perfectuser21/cecelia',provider:'codex',accountId:'team3',
        attemptId: 'attempt-1',
        machineId: MACHINE,
        deadlineAt: '2026-07-27T13:00:00.000Z',
      });
      expect(JSON.parse(fetchFn.mock.calls[0][1].body))
        .toHaveProperty('github_credential_envelope', GITHUB_ENVELOPE);
    },
  );

  it('fails closed before contacting Worker when a GitHub writer broker is unavailable', async () => {
    const fetchFn = vi.fn();
    const transport = createTransport({
      fetchFn,
      githubCredentialBroker: undefined,
    });

    await expect(transport.prepare(prepareInput({
      bundle: {
        role: 'publisher',
        inputs: prepareInput().bundle.inputs,
        constraints: { timeout_seconds: 3600 },
      },
    }))).rejects.toThrow(
      'remote_bridge_github_credential_broker_unavailable',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each(['reviewer', 'reporter'])(
    'does not issue a GitHub credential envelope for read-only role %s',
    async (role) => {
      const issue = vi.fn();
      const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
      const transport = createTransport({
        fetchFn,
        githubCredentialBroker: { issue },
      });

      await transport.prepare(prepareInput({
        bundle: {
          role,
          inputs: prepareInput().bundle.inputs,
          constraints: { timeout_seconds: 3600 },
        },
      }));

      expect(issue).not.toHaveBeenCalled();
      expect(JSON.parse(fetchFn.mock.calls[0][1].body))
        .not.toHaveProperty('github_credential_envelope');
    },
  );

  it('fails closed before contacting the Worker when a Codex broker is unavailable', async () => {
    const fetchFn = vi.fn();
    const transport = createTransport({ fetchFn, credentialBroker: undefined });

    await expect(transport.prepare(prepareInput())).rejects.toThrow(
      'remote_bridge_credential_broker_unavailable',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fails closed before contacting the Worker when the broker returns no envelope', async () => {
    const fetchFn = vi.fn();
    const transport = createTransport({
      fetchFn,
      credentialBroker: { issue: vi.fn(async () => undefined) },
    });

    await expect(transport.prepare(prepareInput())).rejects.toThrow(
      'remote_bridge_credential_envelope_invalid',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fails closed before contacting the Worker when the computed deadline is outside the ISO date range', async () => {
    const fetchFn = vi.fn();
    const issue = vi.fn();
    const transport = createTransport({
      fetchFn,
      credentialBroker: { issue },
      now: () => 8_640_000_000_000_000 - 1000,
    });

    await expect(transport.prepare(prepareInput())).rejects.toThrow(
      'remote_bridge_invalid_attempt_timeout',
    );
    expect(issue).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not issue or send a Codex credential envelope for another provider', async () => {
    const issue = vi.fn();
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({ fetchFn, credentialBroker: { issue } });

    await transport.prepare(prepareInput({
      spec: { provider: 'claude', command: 'claude' },
      target: { provider: 'claude', account: 'claude-team1' },
    }));

    expect(issue).not.toHaveBeenCalled();
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).not.toHaveProperty(
      'credential_envelope',
    );
  });

  it('uses zero when lease generation is absent', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({ fetchFn });
    const input = prepareInput();
    delete input.attempt.lease_generation;

    await transport.prepare(input);

    expect(JSON.parse(fetchFn.mock.calls[0][1].body).lease_generation).toBe(0);
  });

  it('converts only the server-owned canary sentinel into a path-free workspace capability', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({ fetchFn });

    await transport.prepare(prepareInput({
      bundle: {
        inputs: {
          worktree_path: '/var/empty/kernel-fleet-canary',
        },
      },
      spec: {
        cwd: '/Users/attacker/repos/cecelia',
        workspace: {
          kind: 'disposable-canary-v1',
          path: '/Users/attacker/repos/cecelia',
        },
      },
    }));

    const requestBody = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(requestBody.provider_spec.workspace).toEqual({
      kind: 'disposable-canary-v1',
      attempt_id: 'attempt-1',
    });
    expect(JSON.stringify(requestBody.provider_spec)).not.toContain('/Users/attacker');
    expect(requestBody.provider_spec).not.toHaveProperty('cwd');
  });

  it('does not trust a provider cwd or workspace when the bundle is not a canary', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({ fetchFn });

    await transport.prepare(prepareInput({
      bundle: {
        inputs: {
          worktree_path: '/Users/operator/repos/cecelia',
        },
      },
      spec: {
        cwd: '/var/empty/kernel-fleet-canary',
        workspace: {
          kind: 'disposable-canary-v1',
          attempt_id: 'attempt-1',
        },
      },
    }));

    const providerSpec = JSON.parse(fetchFn.mock.calls[0][1].body).provider_spec;
    expect(providerSpec).not.toHaveProperty('workspace');
    expect(providerSpec).not.toHaveProperty('cwd');
  });

  it('freezes a successful prepare receipt', async () => {
    const transport = createTransport();

    const result = await transport.prepare(prepareInput());

    expect(Object.isFrozen(result)).toBe(true);
  });

  it('copies and freezes URL routing at construction instead of trusting later mutations', async () => {
    const bridgeUrls = { [MACHINE]: BRIDGE_URL };
    const fetchFn = vi.fn(async () => jsonResponse(202, acceptedPrepareResponse()));
    const transport = createTransport({ bridgeUrls, fetchFn });
    bridgeUrls[MACHINE] = 'http://attacker.invalid:9000';
    bridgeUrls['xian-mac-m1'] = 'http://attacker.invalid:9001';

    await transport.prepare(prepareInput());

    expect(fetchFn.mock.calls[0][0]).toBe(`${BRIDGE_URL}/harness/attempts/prepare`);
    await expect(transport.prepare(prepareInput({
      target: { machine: 'xian-mac-m1' },
    }))).rejects.toThrow('remote_bridge_unknown_machine');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it.each([
    ['disabled transport', { enabled: false }, 'remote_bridge_disabled'],
    ['short shared secret', { sharedSecret: 'short' }, 'remote_bridge_invalid_shared_secret'],
    ['missing machine URL', { bridgeUrls: {} }, 'remote_bridge_unknown_machine'],
    ['invalid machine URL', { bridgeUrls: { [MACHINE]: 'file:///tmp/bridge.sock' } }, 'remote_bridge_invalid_bridge_url'],
    ['invalid Brain URL', { brainUrl: 'ftp://brain.internal' }, 'remote_bridge_invalid_brain_url'],
  ])('fails closed for %s without making a request', async (_case, config, errorCode) => {
    const fetchFn = vi.fn();
    const transport = createTransport({ fetchFn, ...config });

    await expect(transport.prepare(prepareInput())).rejects.toThrow(errorCode);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects inherited URL-map keys as unknown machines', async () => {
    const bridgeUrls = Object.create({ [MACHINE]: BRIDGE_URL });
    const fetchFn = vi.fn();
    const transport = createTransport({ bridgeUrls, fetchFn });

    await expect(transport.prepare(prepareInput())).rejects.toThrow(
      'remote_bridge_unknown_machine',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ['attempt id', { attempt: { id: '' } }, 'remote_bridge_invalid_attempt_id'],
    ['run id', { attempt: { run_id: '' } }, 'remote_bridge_invalid_run_id'],
    ['lease owner', { attempt: { lease_owner: '' } }, 'remote_bridge_invalid_lease_owner'],
    ['callback token', { attempt: { callbackSecret: '' } }, 'remote_bridge_invalid_callback_token'],
    ['machine', { target: { machine: '' } }, 'remote_bridge_invalid_machine'],
  ])('requires a nonempty %s before prepare', async (_field, inputOverride, errorCode) => {
    const fetchFn = vi.fn();
    const transport = createTransport({ fetchFn });

    await expect(transport.prepare(prepareInput(inputOverride))).rejects.toThrow(errorCode);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [200, 'remote_bridge_prepare_http_200'],
    [301, 'remote_bridge_prepare_http_301'],
    [302, 'remote_bridge_prepare_http_302'],
    [307, 'remote_bridge_prepare_http_307'],
    [308, 'remote_bridge_prepare_http_308'],
    [400, 'remote_bridge_prepare_http_400'],
    [404, 'remote_bridge_prepare_http_404'],
    [409, 'remote_bridge_prepare_conflict'],
    [500, 'remote_bridge_prepare_http_500'],
  ])('accepts only HTTP 202 (received %s)', async (status, errorCode) => {
    const fetchFn = vi.fn(async () => jsonResponse(status, { secret: CALLBACK_TOKEN }));
    const sleepFn = vi.fn(async () => {});
    const transport = createTransport({ fetchFn, sleepFn });

    const prepare = transport.prepare(prepareInput());

    await expect(prepare).rejects.toThrow(errorCode);
    await expect(prepare).rejects.not.toThrow(CALLBACK_TOKEN);
    expect(fetchFn).toHaveBeenCalledTimes(status === 500 ? 3 : 1);
    expect(sleepFn.mock.calls).toEqual(status === 500 ? [[5000], [5000]] : []);
  });

  // 第 61 批：失败不留原因病（memory failure-without-reason-pattern）——fleet 对 4xx 把
  // 结构化错误码放在响应体 {error}，透传层此前丢弃 → 调用方只见 http_400 只能靠猜。
  it('第61批：非 2xx 且响应体带合法错误码 → 错误信息追加 :code（可诊断）', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(400, { error: 'frozen_contract_identity_invalid' }));
    const transport = createTransport({ fetchFn });
    await expect(transport.prepare(prepareInput())).rejects.toThrow(
      'remote_bridge_prepare_http_400:frozen_contract_identity_invalid',
    );
  });

  it('第61批：响应体错误码不合法（含空格/超长/敏感串）→ 不拼接，不泄露', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(400, { error: `bad ${CALLBACK_TOKEN} value` }));
    const transport = createTransport({ fetchFn });
    const prepare = transport.prepare(prepareInput());
    await expect(prepare).rejects.toThrow('remote_bridge_prepare_http_400');
    await expect(prepare).rejects.not.toThrow(CALLBACK_TOKEN);
  });

  it.each([
    ['non-accepted response', { status: 'queued' }, 'remote_bridge_prepare_not_accepted'],
    ['empty job id', {
      job_id: '',
      attestation: '0'.repeat(64),
    }, 'remote_bridge_prepare_invalid_job_id'],
    ['mismatched machine', { actual_machine_id: 'xian-mac-m1' }, 'remote_bridge_machine_mismatch'],
    ['bad attestation', { attestation: '0'.repeat(64) }, 'remote_bridge_attestation_invalid'],
    ['uppercase attestation', {
      attestation: signMachineAttestation({
        secret: SHARED_SECRET,
        attemptId: 'attempt-1',
        machineId: MACHINE,
        jobId: 'job-1',
      }).toUpperCase(),
    }, 'remote_bridge_attestation_invalid'],
  ])('rejects a 202 response with %s', async (_case, responseOverride, errorCode) => {
    const fetchFn = vi.fn(async () => jsonResponse(
      202,
      acceptedPrepareResponse(responseOverride),
    ));
    const transport = createTransport({ fetchFn });

    await expect(transport.prepare(prepareInput())).rejects.toThrow(errorCode);
  });

  it('rejects malformed JSON with a sanitized error', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => {
        throw new Error(`parser exposed ${SHARED_SECRET} ${CALLBACK_TOKEN}`);
      },
    }));
    const transport = createTransport({ fetchFn });

    const prepare = transport.prepare(prepareInput());

    await expect(prepare).rejects.toThrow('remote_bridge_prepare_invalid_json');
    await expect(prepare).rejects.not.toThrow(SHARED_SECRET);
    await expect(prepare).rejects.not.toThrow(CALLBACK_TOKEN);
  });

  it('aborts timed-out requests and reports a sanitized timeout', async () => {
    const fetchFn = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(new Error(`aborted ${SHARED_SECRET} ${CALLBACK_TOKEN}`));
      }, { once: true });
    }));
    const sleepFn = vi.fn(async () => {});
    const transport = createTransport({ fetchFn, sleepFn, timeoutMs: 5 });

    const prepare = transport.prepare(prepareInput());

    await expect(prepare).rejects.toThrow('remote_bridge_prepare_timeout');
    await expect(prepare).rejects.not.toThrow(SHARED_SECRET);
    await expect(prepare).rejects.not.toThrow(CALLBACK_TOKEN);
    expect(fetchFn.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('sanitizes network failures', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error(`network exposed ${SHARED_SECRET} ${CALLBACK_TOKEN}`);
    });
    const sleepFn = vi.fn(async () => {});
    const transport = createTransport({ fetchFn, sleepFn });

    const prepare = transport.prepare(prepareInput());

    await expect(prepare).rejects.toThrow('remote_bridge_prepare_request_failed');
    await expect(prepare).rejects.not.toThrow(SHARED_SECRET);
    await expect(prepare).rejects.not.toThrow(CALLBACK_TOKEN);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleepFn.mock.calls).toEqual([[5000], [5000]]);
  });
});

