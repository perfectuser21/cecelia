import { describe, expect, it, vi } from 'vitest';

const NOW_MS = Date.parse('2026-07-27T08:00:00.000Z');
const GIB = 1024 ** 3;
const URLS = {
  FLEET_WORKER_US_MAC_M4_URL: 'http://us-worker.internal:5231',
  FLEET_WORKER_XIAN_MAC_M4_URL: 'http://xian-m4-worker.internal:5231/',
  FLEET_WORKER_XIAN_MAC_M1_URL: 'http://xian-m1-worker.internal:5231',
};

async function loadContract() {
  const client = await import('./node-admission-client.js').catch(() => ({}));
  const profiles = await import('./node-profile.js').catch(() => ({}));
  const admission = await import('./node-admission.js').catch(() => ({}));
  expect(client.createNodeAdmissionClient, 'missing admission client factory').toBeTypeOf('function');
  expect(client.workerUrlsFromEnv, 'missing server-owned Worker URL mapping').toBeTypeOf('function');
  expect(profiles.getNodeProfile, 'missing NodeProfile lookup').toBeTypeOf('function');
  expect(admission.evaluateBaseAdmission, 'missing Brain-owned evaluator').toBeTypeOf('function');
  return { ...client, ...profiles, ...admission };
}

function response(body, status = 200, headers = {}) {
  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    },
  );
}

function reportFor(profile, patch = {}) {
  const policy = profile.version_policy;
  const report = {
    schema_version: 'fleet-node-health/v1',
    machine_id: profile.machine_id,
    observed_at: new Date(NOW_MS - 1_000).toISOString(),
    worker: {
      protocol_version: policy.worker_protocol,
      contract_version: policy.worker_contract,
      version: policy.worker,
    },
    runner: { version: policy.runner, image_digest: profile.runner_image_digest },
    os: { version: policy.os },
    orbstack: { version: policy.orbstack },
    docker: { available: true, observed_at: new Date(NOW_MS - 1_000).toISOString() },
    resources: {
      cpu_cores: 6,
      memory_bytes: 8 * GIB,
      disk_free_bytes: 40 * GIB,
      disk_used_percent: 85,
      cpu_pressure_percent: profile.resources.cpu_pressure_max_percent - 1,
      memory_pressure_percent: profile.resources.memory_pressure_max_percent - 1,
    },
    git: { available: true, version: policy.git },
    node: { available: true, version: policy.node },
    codex: { available: true, version: policy.codex },
    tailscale: { connected: true },
    callback: { reachable: true },
    time_sync: { synchronized: true },
    power: { sleep_disabled: true, auto_power_on: true },
    launchd: { loaded: true, domain: 'system', kind: 'LaunchDaemon' },
    worktree: { root_ready: true },
    container: { probe_succeeded: true },
    drain: { active: false },
  };
  for (const [key, value] of Object.entries(patch)) {
    report[key] = value && typeof value === 'object' && report[key]
      ? { ...report[key], ...value }
      : value;
  }
  return report;
}

function expectFailed(result, signature) {
  expect(result).toMatchObject({
    state: 'draining',
    base_admitted: false,
    dispatch_ready: false,
    signature,
  });
}

describe('Fleet Node admission client', () => {
  it('maps only canonical machine IDs to server-owned environment URLs', async () => {
    const { workerUrlsFromEnv } = await loadContract();
    expect(workerUrlsFromEnv({
      ...URLS,
      FLEET_WORKER_MOON_BASE_URL: 'http://attacker.invalid',
    })).toEqual({
      'us-mac-m4': 'http://us-worker.internal:5231',
      'xian-mac-m4': 'http://xian-m4-worker.internal:5231',
      'xian-mac-m1': 'http://xian-m1-worker.internal:5231',
    });
  });

  it('GETs /health with a bounded request and evaluates it in Brain-owned code', async () => {
    const contract = await loadContract();
    const profile = contract.getNodeProfile('xian-mac-m4');
    const health = reportFor(profile);
    const fetchFn = vi.fn(async () => response(health));
    const evaluateBaseAdmissionFn = vi.fn(() => ({
      machine_id: profile.machine_id,
      state: 'base_admitted',
      base_admitted: true,
      dispatch_ready: false,
      observed_at: health.observed_at,
      reasons: [],
    }));
    const client = contract.createNodeAdmissionClient({
      env: URLS,
      fetchFn,
      evaluateBaseAdmissionFn,
      now: () => NOW_MS,
      requestTimeoutMs: 700,
    });

    await expect(client.getAdmission('xian-mac-m4')).resolves.toMatchObject({
      state: 'base_admitted',
      base_admitted: true,
      dispatch_ready: false,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'http://xian-m4-worker.internal:5231/health',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ accept: 'application/json' }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(evaluateBaseAdmissionFn).toHaveBeenCalledWith(
      health,
      expect.objectContaining({ profile, nowMs: NOW_MS }),
    );
  });

  it('never trusts admission, online, or slot claims made by a Worker report', async () => {
    const contract = await loadContract();
    const profile = contract.getNodeProfile('us-mac-m4');
    const health = {
      ...reportFor(profile),
      base_admitted: true,
      dispatch_ready: true,
      online: true,
      available_slots: 999,
    };
    const evaluateBaseAdmissionFn = vi.fn(() => ({
      machine_id: profile.machine_id,
      state: 'draining',
      base_admitted: false,
      dispatch_ready: false,
      reasons: [{ code: 'runner_digest_drift', field: 'runner.image_digest', message: 'drift' }],
    }));
    const client = contract.createNodeAdmissionClient({
      env: URLS,
      fetchFn: vi.fn(async () => response(health)),
      evaluateBaseAdmissionFn,
      now: () => NOW_MS,
    });

    const result = await client.getAdmission('us-mac-m4');

    expect(result.base_admitted).toBe(false);
    expect(result.dispatch_ready).toBe(false);
    expect(result).not.toHaveProperty('online');
    expect(result).not.toHaveProperty('available_slots');
    expect(evaluateBaseAdmissionFn).toHaveBeenCalledOnce();
  });

  it('clamps cached evidence to at most 90 seconds', async () => {
    const contract = await loadContract();
    const profile = contract.getNodeProfile('us-mac-m4');
    let nowMs = NOW_MS;
    const fetchFn = vi.fn(async () => response(reportFor(profile, {
      observed_at: new Date(nowMs).toISOString(),
      docker: { observed_at: new Date(nowMs).toISOString() },
    })));
    const client = contract.createNodeAdmissionClient({
      env: URLS,
      fetchFn,
      evaluateBaseAdmissionFn: contract.evaluateBaseAdmission,
      now: () => nowMs,
      cacheTtlMs: 10 * 60_000,
    });

    await client.getAdmission('us-mac-m4');
    nowMs += 89_999;
    await client.getAdmission('us-mac-m4');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    nowMs += 2;
    await client.getAdmission('us-mac-m4');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('forceFresh bypasses otherwise valid cached evidence', async () => {
    const contract = await loadContract();
    const profile = contract.getNodeProfile('us-mac-m4');
    const fetchFn = vi.fn(async () => response(reportFor(profile)));
    const client = contract.createNodeAdmissionClient({
      env: URLS,
      fetchFn,
      now: () => NOW_MS,
    });

    await client.getAdmission('us-mac-m4');
    await client.getAdmission('us-mac-m4');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await client.getAdmission('us-mac-m4', { forceFresh: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['URL missing', {}, null, 'worker_url_missing'],
    ['HTTP rejection', URLS, response({ error: 'nope' }, 503), 'worker_http_503'],
    ['health report missing', URLS, response(null), 'health_report_missing'],
    ['malformed JSON', URLS, response('{not json'), 'health_report_malformed'],
    ['oversized report', URLS, response('{}', 200, { 'content-length': '70000' }), 'health_report_too_large'],
  ])('fails closed when %s', async (_name, env, fetchResponse, signature) => {
    const contract = await loadContract();
    const fetchFn = vi.fn(async () => fetchResponse);
    const client = contract.createNodeAdmissionClient({
      env,
      fetchFn,
      now: () => NOW_MS,
    });

    const result = await client.getAdmission('us-mac-m4');

    expectFailed(result, signature);
    if (signature === 'worker_url_missing') expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ['fetch rejection', new Error(`network-${'x'.repeat(500)}`), 'worker_fetch_failed'],
    ['AbortError timeout', new DOMException('request timed out', 'AbortError'), 'worker_timeout'],
  ])('fails closed with a bounded signature on %s', async (_name, error, signature) => {
    const contract = await loadContract();
    const client = contract.createNodeAdmissionClient({
      env: URLS,
      fetchFn: vi.fn(async () => { throw error; }),
      now: () => NOW_MS,
      requestTimeoutMs: 60 * 60_000,
    });

    const result = await client.getAdmission('us-mac-m4');

    expectFailed(result, signature);
    expect(result.signature.length).toBeLessThanOrEqual(64);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2_048);
    expect(JSON.stringify(result)).not.toContain('x'.repeat(200));
  });

  it('actively aborts a stalled fetch at the configured bounded timeout', async () => {
    const contract = await loadContract();
    let receivedSignal;
    const fetchFn = vi.fn(async (_url, options) => {
      receivedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        const rejectOnAbort = () => reject(new DOMException('timed out', 'AbortError'));
        if (options.signal.aborted) rejectOnAbort();
        else options.signal.addEventListener('abort', rejectOnAbort, { once: true });
      });
    });
    const client = contract.createNodeAdmissionClient({
      env: URLS,
      fetchFn,
      now: () => NOW_MS,
      requestTimeoutMs: 10,
    });
    const startedAt = performance.now();

    const result = await client.getAdmission('us-mac-m4');

    expectFailed(result, 'worker_timeout');
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal.aborted).toBe(true);
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  it('aborts and cancels a stalled response body within the request timeout', async () => {
    const contract = await loadContract();
    let bodyCancelled = false;
    const body = new ReadableStream({
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        bodyCancelled = true;
      },
    });
    const client = contract.createNodeAdmissionClient({
      env: URLS,
      fetchFn: vi.fn(async () => new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
      now: () => NOW_MS,
      requestTimeoutMs: 10,
    });
    const startedAt = performance.now();

    const result = await Promise.race([
      client.getAdmission('us-mac-m4'),
      new Promise((resolve) => {
        setTimeout(() => resolve({ signature: 'test_deadline_exceeded' }), 250);
      }),
    ]);

    expectFailed(result, 'worker_timeout');
    expect(bodyCancelled).toBe(true);
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  it('fails closed when reading a nominally successful response body rejects', async () => {
    const contract = await loadContract();
    const body = new ReadableStream({
      pull(controller) {
        controller.error(new Error('body stream reset'));
      },
    });
    const client = contract.createNodeAdmissionClient({
      env: URLS,
      fetchFn: vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        body,
        text: vi.fn(async () => { throw new Error('body stream reset'); }),
      })),
      now: () => NOW_MS,
    });

    expectFailed(await client.getAdmission('us-mac-m4'), 'health_report_read_failed');
  });

  it('fails closed when the Brain-owned evaluator throws', async () => {
    const contract = await loadContract();
    const profile = contract.getNodeProfile('us-mac-m4');
    const client = contract.createNodeAdmissionClient({
      env: URLS,
      fetchFn: vi.fn(async () => response(reportFor(profile))),
      evaluateBaseAdmissionFn: vi.fn(() => { throw new Error('evaluator bug'); }),
      now: () => NOW_MS,
    });

    expectFailed(await client.getAdmission('us-mac-m4'), 'admission_evaluator_failed');
  });

  it('bounds a chunked oversized body even when Content-Length is unavailable', async () => {
    const contract = await loadContract();
    const oversized = `"${'z'.repeat(70_000)}"`;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(oversized.slice(0, 40_000)));
        controller.enqueue(new TextEncoder().encode(oversized.slice(40_000)));
        controller.close();
      },
    });
    const client = contract.createNodeAdmissionClient({
      env: URLS,
      fetchFn: vi.fn(async () => new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
      now: () => NOW_MS,
    });

    expectFailed(await client.getAdmission('us-mac-m4'), 'health_report_too_large');
  });

  it('fails closed for an unknown machine without making a request', async () => {
    const contract = await loadContract();
    const fetchFn = vi.fn();
    const client = contract.createNodeAdmissionClient({
      env: URLS,
      fetchFn,
      now: () => NOW_MS,
    });

    expectFailed(await client.getAdmission('moon-base'), 'unknown_fleet_node');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ['report', 89_900, 1_000],
    ['Docker', 1_000, 89_900],
  ])('does not cache past the absolute %s evidence freshness deadline', async (
    _name,
    reportAgeMs,
    dockerAgeMs,
  ) => {
    const contract = await loadContract();
    const profile = contract.getNodeProfile('us-mac-m4');
    let nowMs = NOW_MS;
    const fetchFn = vi.fn(async () => response(reportFor(profile, {
      observed_at: new Date(nowMs - reportAgeMs).toISOString(),
      docker: { observed_at: new Date(nowMs - dockerAgeMs).toISOString() },
    })));
    const client = contract.createNodeAdmissionClient({
      env: URLS,
      fetchFn,
      now: () => nowMs,
      cacheTtlMs: 90_000,
    });

    await client.getAdmission('us-mac-m4');
    nowMs += 101;
    await client.getAdmission('us-mac-m4');

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['stale evidence', { observed_at: new Date(NOW_MS - 90_001).toISOString() }, 'health_report_stale'],
    ['identity mismatch', { machine_id: 'xian-mac-m1' }, 'machine_identity_mismatch'],
    ['drain marker', { drain: { active: true } }, 'node_drained'],
  ])('fails closed for %s instead of falling back to online/slots', async (_name, patch, reason) => {
    const contract = await loadContract();
    const profile = contract.getNodeProfile('us-mac-m4');
    const client = contract.createNodeAdmissionClient({
      env: URLS,
      fetchFn: vi.fn(async () => response(reportFor(profile, patch))),
      now: () => NOW_MS,
    });

    const result = await client.getAdmission('us-mac-m4');

    expect(result).toMatchObject({
      state: 'draining',
      base_admitted: false,
      dispatch_ready: false,
    });
    expect(result.reasons.map(({ code }) => code)).toContain(reason);
    expect(result).not.toHaveProperty('online');
    expect(result).not.toHaveProperty('available_slots');
  });
});
