import { createHash } from 'node:crypto';

const PROBE_TIMEOUT_MS = 20_000;
const MAX_PROBE_RESPONSE_BYTES = 256 * 1024;
const STAGING_HOSTS = new Set([
  '127.0.0.1',
  '::1',
  'brain-staging',
  'dashboard-staging',
  'host.docker.internal',
  'localhost',
  'staging',
]);

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function canonicalOrigin(raw, environment) {
  const value = new URL(raw);
  if (
    !['http:', 'https:'].includes(value.protocol)
    || value.username
    || value.password
    || value.pathname !== '/'
    || value.search
    || value.hash
  ) {
    throw new Error('release_e2e_probe_origin_invalid');
  }
  if (environment === 'staging' && !STAGING_HOSTS.has(value.hostname)) {
    throw new Error('release_e2e_probe_staging_origin_denied');
  }
  return value.origin;
}

async function readBoundedJson(response) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (
    Number.isFinite(declaredLength)
    && declaredLength > MAX_PROBE_RESPONSE_BYTES
  ) {
    throw new Error('release_e2e_probe_response_too_large');
  }
  let text = '';
  let bytes = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PROBE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('release_e2e_probe_response_too_large');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } else {
    text = await response.text();
    bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > MAX_PROBE_RESPONSE_BYTES) {
      throw new Error('release_e2e_probe_response_too_large');
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('release_e2e_probe_response_invalid');
  }
}

async function requestJson(fetchFn, url) {
  const response = await fetchFn(url, {
    method: 'GET',
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!response?.ok) {
    throw new Error(`release_e2e_probe_http_${response?.status ?? 'unknown'}`);
  }
  return readBoundedJson(response);
}

function exactArtifact(context, name) {
  return context.artifactVersions.find((artifact) => artifact.name === name);
}

const PROBE_REGISTRY = Object.freeze({
  'brain.health': async (context) => {
    const value = await requestJson(
      context.fetchFn,
      `${context.origins.brain}/api/brain/health`,
    );
    if (value?.status !== 'healthy') {
      throw new Error('release_e2e_probe_brain_unhealthy');
    }
    return {
      status: value.status,
      version: value.version ?? null,
      git_sha: value.git_sha ?? null,
    };
  },

  'brain.release-identity': async (context) => {
    const expected = exactArtifact(context, 'brain');
    if (!expected) throw new Error('release_e2e_probe_brain_not_routed');
    const value = await requestJson(
      context.fetchFn,
      `${context.origins.brain}/api/brain/health`,
    );
    if (
      value?.status !== 'healthy'
      || value.git_sha !== context.mergeSha
      || value.version !== expected.version
    ) {
      throw new Error('release_e2e_probe_brain_identity_mismatch');
    }
    return {
      status: value.status,
      version: value.version,
      git_sha: value.git_sha,
    };
  },

  'brain.status-full': async (context) => {
    const value = await requestJson(
      context.fetchFn,
      `${context.origins.brain}/api/brain/status/full`,
    );
    if (!value || value.error != null) {
      throw new Error('release_e2e_probe_brain_status_invalid');
    }
    return { ok: true };
  },

  'dashboard.release-identity': async (context) => {
    if (!exactArtifact(context, 'workspace')) {
      throw new Error('release_e2e_probe_dashboard_not_routed');
    }
    const value = await requestJson(
      context.fetchFn,
      `${context.origins.dashboard}/build-info.json`,
    );
    if (value?.git_sha !== context.mergeSha) {
      throw new Error('release_e2e_probe_dashboard_identity_mismatch');
    }
    return { git_sha: value.git_sha };
  },
});

export const RELEASE_E2E_PROBE_IDS = Object.freeze(
  Object.keys(PROBE_REGISTRY).sort(),
);

export function isRegisteredReleaseE2EProbe(value) {
  return typeof value === 'string'
    && Object.hasOwn(PROBE_REGISTRY, value);
}

export async function executeRegisteredReleaseE2EProbes(acceptance, {
  environment,
  artifactVersions,
  mergeSha,
  fetchFn = globalThis.fetch,
  endpoints,
  now = () => new Date(),
} = {}) {
  if (
    typeof fetchFn !== 'function'
    || !endpoints?.brain
    || !endpoints?.dashboard
  ) {
    throw new Error('release_e2e_probe_runtime_unavailable');
  }
  const origins = Object.freeze({
    brain: canonicalOrigin(endpoints.brain, environment),
    dashboard: canonicalOrigin(endpoints.dashboard, environment),
  });
  const scenarioResults = [];
  const probeResults = [];
  for (const scenario of acceptance.scenarios) {
    const startedAt = now().toISOString();
    const observations = [];
    let status = 'pass';
    try {
      for (const command of scenario.commands) {
        try {
          const evidence = await PROBE_REGISTRY[command.id]({
            environment,
            artifactVersions,
            mergeSha,
            fetchFn,
            origins,
          });
          const observationDigest = digest({ id: command.id, evidence });
          observations.push({ id: command.id, evidence });
          probeResults.push({
            scenario_name: scenario.name,
            probe_id: command.id,
            status: 'pass',
            observation_digest: observationDigest,
          });
        } catch (error) {
          const failure = error?.message ?? 'release_e2e_probe_failed';
          observations.push({ id: command.id, error: failure });
          probeResults.push({
            scenario_name: scenario.name,
            probe_id: command.id,
            status: 'fail',
            observation_digest: digest({ id: command.id, error: failure }),
          });
          throw error;
        }
      }
    } catch (error) {
      status = 'fail';
      observations.push({
        error: error?.message ?? 'release_e2e_probe_failed',
      });
    }
    const finishedAt = now().toISOString();
    scenarioResults.push({
      name: scenario.name,
      status,
      started_at: startedAt,
      finished_at: finishedAt,
      log_digest: digest({
        environment,
        scenario: scenario.name,
        observations,
      }),
    });
  }
  const scenariosPassed = scenarioResults.filter(
    (scenario) => scenario.status === 'pass',
  ).length;
  return {
    verdict: scenariosPassed === scenarioResults.length ? 'PASS' : 'FAIL',
    scenariosTotal: scenarioResults.length,
    scenariosPassed,
    scenarioResults,
    probeResults,
  };
}

export const __test__ = {
  MAX_PROBE_RESPONSE_BYTES,
  PROBE_REGISTRY,
  canonicalOrigin,
  readBoundedJson,
};
