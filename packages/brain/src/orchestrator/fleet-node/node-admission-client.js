import { evaluateBaseAdmission } from './node-admission.js';
import { getNodeProfile } from './node-profile.js';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CACHE_TTL_MS = 90_000;
const DEFAULT_CACHE_TTL_MS = 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const MAX_REQUEST_TIMEOUT_MS = 10_000;
const MAX_REASONS = 16;

const WORKER_URL_ENV = Object.freeze({
  'us-mac-m4': 'FLEET_WORKER_US_MAC_M4_URL',
  'xian-mac-m4': 'FLEET_WORKER_XIAN_MAC_M4_URL',
  'xian-mac-m1': 'FLEET_WORKER_XIAN_MAC_M1_URL',
});

function boundedInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(0, Math.trunc(number)));
}

function normalizeWorkerUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)
      || !parsed.hostname
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || !['', '/'].includes(parsed.pathname)) {
      return null;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function workerUrlsFromEnv(env = {}) {
  const urls = {};
  for (const [machineId, envKey] of Object.entries(WORKER_URL_ENV)) {
    const url = normalizeWorkerUrl(env?.[envKey]);
    if (url) urls[machineId] = url;
  }
  return urls;
}

function boundedReason(reason) {
  const code = String(reason?.code ?? 'node_not_base_admitted').slice(0, 64)
    || 'node_not_base_admitted';
  const field = String(reason?.field ?? 'report').slice(0, 96) || 'report';
  const message = String(reason?.message ?? 'Fleet node evidence was rejected.').slice(0, 160)
    || 'Fleet node evidence was rejected.';
  return { code, field, message };
}

function failure(machineId, signature) {
  const safeSignature = String(signature || 'node_admission_failed').slice(0, 64);
  return Object.freeze({
    machine_id: Object.hasOwn(WORKER_URL_ENV, machineId) ? machineId : null,
    state: 'draining',
    base_admitted: false,
    dispatch_ready: false,
    observed_at: null,
    signature: safeSignature,
    reasons: [boundedReason({
      code: safeSignature,
      field: 'report',
      message: 'Fleet node health evidence is unavailable or invalid.',
    })],
  });
}

function boundedAdmission(machineId, evaluated) {
  const reasons = Array.isArray(evaluated?.reasons)
    ? evaluated.reasons.slice(0, MAX_REASONS).map(boundedReason)
    : [];
  const admitted = evaluated?.base_admitted === true
    && evaluated?.state === 'base_admitted'
    && reasons.length === 0;
  const result = {
    machine_id: machineId,
    state: admitted ? 'base_admitted' : 'draining',
    base_admitted: admitted,
    dispatch_ready: admitted && evaluated?.dispatch_ready === true,
    observed_at: admitted
      && typeof evaluated?.observed_at === 'string'
      && Number.isFinite(Date.parse(evaluated.observed_at))
      ? evaluated.observed_at.slice(0, 40)
      : null,
    reasons,
  };
  if (!admitted && typeof evaluated?.signature === 'string') {
    result.signature = evaluated.signature.slice(0, 64);
  }
  return Object.freeze(result);
}

function abortError() {
  return new DOMException('Fleet Worker request timed out.', 'AbortError');
}

async function withAbort(operation, signal) {
  if (signal.aborted) throw abortError();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function readBoundedBody(response, signal) {
  const contentLength = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { error: 'health_report_too_large' };
  }

  if (!response?.body?.getReader) {
    try {
      const text = await withAbort(response.text(), signal);
      if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
        return { error: 'health_report_too_large' };
      }
      return { text };
    } catch (error) {
      if (error?.name === 'AbortError') return { error: 'worker_timeout' };
      return { error: 'health_report_read_failed' };
    }
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return { error: 'health_report_too_large' };
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      void reader.cancel().catch(() => {});
      return { error: 'worker_timeout' };
    }
    return { error: 'health_report_read_failed' };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A timed-out pending read owns the lock until cancellation settles.
    }
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return { text: body.toString('utf8') };
}

export function createNodeAdmissionClient(options = {}) {
  const env = options.env ?? process.env;
  const workerUrls = options.workerUrls ?? workerUrlsFromEnv(env);
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const evaluateBaseAdmissionFn = options.evaluateBaseAdmissionFn ?? evaluateBaseAdmission;
  const now = options.now ?? Date.now;
  const requestTimeoutMs = boundedInteger(
    options.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    MAX_REQUEST_TIMEOUT_MS,
  );
  const cacheTtlMs = boundedInteger(
    options.cacheTtlMs ?? env.FLEET_NODE_ADMISSION_CACHE_TTL_MS,
    DEFAULT_CACHE_TTL_MS,
    MAX_CACHE_TTL_MS,
  );
  const cache = new Map();
  const pending = new Map();

  async function fetchAdmission(machineId, profile) {
    const workerUrl = normalizeWorkerUrl(workerUrls?.[machineId]);
    if (!workerUrl) {
      return { value: failure(machineId, 'worker_url_missing'), evidenceExpiresAt: null };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, requestTimeoutMs));
    try {
      const response = await fetchFn(`${workerUrl}/health`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      });

      if (!response?.ok) {
        return {
          value: failure(machineId, `worker_http_${Number(response?.status) || 'unknown'}`),
          evidenceExpiresAt: null,
        };
      }
      const body = await readBoundedBody(response, controller.signal);
      if (body.error) {
        return { value: failure(machineId, body.error), evidenceExpiresAt: null };
      }

      let report;
      try {
        report = JSON.parse(body.text);
      } catch {
        return {
          value: failure(machineId, 'health_report_malformed'),
          evidenceExpiresAt: null,
        };
      }
      if (report === null || report === undefined) {
        return {
          value: failure(machineId, 'health_report_missing'),
          evidenceExpiresAt: null,
        };
      }

      let evaluated;
      try {
        evaluated = evaluateBaseAdmissionFn(report, {
          profile,
          nowMs: now(),
        });
      } catch {
        return {
          value: failure(machineId, 'admission_evaluator_failed'),
          evidenceExpiresAt: null,
        };
      }
      const value = boundedAdmission(machineId, evaluated);
      const reportDeadline = Date.parse(report?.observed_at) + MAX_CACHE_TTL_MS;
      const dockerDeadline = Date.parse(report?.docker?.observed_at) + MAX_CACHE_TTL_MS;
      const evidenceExpiresAt = value.base_admitted
        && Number.isFinite(reportDeadline)
        && Number.isFinite(dockerDeadline)
        ? Math.min(reportDeadline, dockerDeadline)
        : null;
      return { value, evidenceExpiresAt };
    } catch (error) {
      return {
        value: failure(
          machineId,
          error?.name === 'AbortError' || controller.signal.aborted
            ? 'worker_timeout'
            : 'worker_fetch_failed',
        ),
        evidenceExpiresAt: null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getAdmission(machineId, { forceFresh = false } = {}) {
    let profile;
    try {
      profile = getNodeProfile(machineId);
    } catch {
      return failure(machineId, 'unknown_fleet_node');
    }

    const currentTime = now();
    const cached = cache.get(machineId);
    if (!forceFresh && cached && currentTime < cached.expiresAt) return cached.value;
    const inFlight = pending.get(machineId);
    if (inFlight) return inFlight.promise;

    const pendingEntry = {};
    const operation = fetchAdmission(machineId, profile)
      .then(({ value, evidenceExpiresAt }) => {
        const fetchedAt = now();
        cache.set(machineId, {
          value,
          expiresAt: Math.min(
            fetchedAt + cacheTtlMs,
            evidenceExpiresAt ?? Number.POSITIVE_INFINITY,
          ),
        });
        return value;
      })
      .finally(() => {
        if (pending.get(machineId) === pendingEntry) pending.delete(machineId);
      });
    pendingEntry.promise = operation;
    pending.set(machineId, pendingEntry);
    return operation;
  }

  return Object.freeze({ getAdmission });
}
