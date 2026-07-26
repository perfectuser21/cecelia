import { verifyMachineAttestation } from './machine-attestation.js';

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json',
});

function isNonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 && !/[\r\n]/.test(value);
}

function requireNonempty(value, name) {
  if (!isNonemptyString(value)) {
    throw new Error(`remote_bridge_invalid_${name}`);
  }
}

function normalizeHttpUrl(value, errorCode) {
  if (!isNonemptyString(value)) {
    throw new Error(errorCode);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(errorCode);
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(errorCode);
  }

  return parsed.href.replace(/\/+$/, '');
}

function copyBridgeUrls(bridgeUrls) {
  if (!bridgeUrls || typeof bridgeUrls !== 'object' || Array.isArray(bridgeUrls)) {
    return Object.freeze(Object.create(null));
  }

  const copy = Object.create(null);
  for (const [machine, url] of Object.entries(bridgeUrls)) {
    copy[machine] = url;
  }
  return Object.freeze(copy);
}

async function parseJson(response, operation, signal) {
  try {
    return await response.json();
  } catch {
    if (signal.aborted) {
      throw new Error(`remote_bridge_${operation}_timeout`);
    }
    throw new Error(`remote_bridge_${operation}_invalid_json`);
  }
}

export function createRemoteBridgeTransport({
  enabled,
  bridgeUrls,
  sharedSecret,
  brainUrl,
  fetchFn = globalThis.fetch,
  timeoutMs = 10000,
} = {}) {
  const machineUrls = copyBridgeUrls(bridgeUrls);
  const configuredSecret = sharedSecret;
  const configuredBrainUrl = brainUrl;
  const configuredFetch = fetchFn;
  const configuredTimeout = timeoutMs;

  function resolveBridge(target) {
    if (enabled !== true) {
      throw new Error('remote_bridge_disabled');
    }
    if (typeof configuredSecret !== 'string' || configuredSecret.length < 32) {
      throw new Error('remote_bridge_invalid_shared_secret');
    }
    if (typeof configuredFetch !== 'function') {
      throw new Error('remote_bridge_invalid_fetch');
    }
    if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
      throw new Error('remote_bridge_invalid_timeout');
    }

    const machine = target?.machine;
    requireNonempty(machine, 'machine');
    if (!Object.hasOwn(machineUrls, machine)) {
      throw new Error('remote_bridge_unknown_machine');
    }

    return {
      machine,
      bridgeUrl: normalizeHttpUrl(
        machineUrls[machine],
        'remote_bridge_invalid_bridge_url',
      ),
    };
  }

  async function request(operation, url, options, consumeResponse) {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error(`remote_bridge_${operation}_timeout`));
      }, configuredTimeout);
    });

    try {
      return await Promise.race([
        Promise.resolve().then(async () => {
          let response;
          try {
            response = await configuredFetch(url, {
              ...options,
              signal: controller.signal,
              redirect: 'error',
            });
          } catch {
            if (timedOut || controller.signal.aborted) {
              throw new Error(`remote_bridge_${operation}_timeout`);
            }
            throw new Error(`remote_bridge_${operation}_request_failed`);
          }
          return consumeResponse(response, controller.signal);
        }),
        timeout,
      ]);
    } catch (error) {
      if (timedOut || controller.signal.aborted) {
        throw new Error(`remote_bridge_${operation}_timeout`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function authHeaders(withJson = false) {
    return withJson
      ? {
          Authorization: `Bearer ${configuredSecret}`,
          ...JSON_HEADERS,
        }
      : { Authorization: `Bearer ${configuredSecret}` };
  }

  return Object.freeze({
    async launch({ attempt, spec, target } = {}) {
      const { machine, bridgeUrl } = resolveBridge(target);
      requireNonempty(attempt?.id, 'attempt_id');
      requireNonempty(attempt?.run_id, 'run_id');
      requireNonempty(attempt?.lease_owner, 'lease_owner');
      requireNonempty(attempt?.callbackSecret, 'callback_token');

      const leaseGeneration = attempt.lease_generation ?? 0;
      if (!Number.isInteger(leaseGeneration) || leaseGeneration < 0) {
        throw new Error('remote_bridge_invalid_lease_generation');
      }

      const normalizedBrainUrl = normalizeHttpUrl(
        configuredBrainUrl,
        'remote_bridge_invalid_brain_url',
      );
      return request(
        'launch',
        `${bridgeUrl}/harness/attempts`,
        {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({
            attempt_id: attempt.id,
            run_id: attempt.run_id,
            lease_owner: attempt.lease_owner,
            lease_generation: leaseGeneration,
            target,
            provider_spec: {
              provider: spec?.provider,
              command: spec?.command,
              args: spec?.args,
              stdin: spec?.stdin,
              output: spec?.output,
            },
            callback_url: `${normalizedBrainUrl}/api/brain/harness/attempts/${encodeURIComponent(attempt.id)}/callback`,
            callback_token: attempt.callbackSecret,
          }),
        },
        async (response, signal) => {
          if (response?.status === 409) {
            throw new Error('remote_bridge_launch_conflict');
          }
          if (response?.status !== 202) {
            throw new Error(`remote_bridge_launch_http_${String(response?.status)}`);
          }

          const receipt = await parseJson(response, 'launch', signal);
          if (receipt?.status !== 'accepted') {
            throw new Error('remote_bridge_launch_not_accepted');
          }
          if (!isNonemptyString(receipt.job_id)) {
            throw new Error('remote_bridge_launch_invalid_job_id');
          }
          if (receipt.actual_machine_id !== machine) {
            throw new Error('remote_bridge_machine_mismatch');
          }
          if (!verifyMachineAttestation({
            secret: configuredSecret,
            attemptId: attempt.id,
            machineId: receipt.actual_machine_id,
            jobId: receipt.job_id,
            attestation: receipt.attestation,
          })) {
            throw new Error('remote_bridge_attestation_invalid');
          }

          return Object.freeze({
            jobId: receipt.job_id,
            actualMachineId: receipt.actual_machine_id,
            executionTransport: 'remote-bridge',
            remoteJobId: receipt.job_id,
            attestationStatus: 'verified',
          });
        },
      );
    },

    async inspect({ attempt, target } = {}) {
      const { bridgeUrl } = resolveBridge(target);
      requireNonempty(attempt?.id, 'attempt_id');
      return request(
        'inspect',
        `${bridgeUrl}/harness/attempts/${encodeURIComponent(attempt.id)}`,
        {
          method: 'GET',
          headers: authHeaders(),
        },
        (response, signal) => {
          if (response?.status === 404) {
            return { status: 'missing', httpStatus: 404 };
          }
          if (response?.status === 409) {
            return { status: 'conflict', httpStatus: 409 };
          }
          if (!response?.ok) {
            throw new Error(`remote_bridge_inspect_http_${String(response?.status)}`);
          }
          return parseJson(response, 'inspect', signal);
        },
      );
    },

    async cancel({ attempt, target } = {}) {
      const { bridgeUrl } = resolveBridge(target);
      requireNonempty(attempt?.id, 'attempt_id');
      requireNonempty(attempt?.lease_owner, 'lease_owner');
      if (!Number.isInteger(attempt?.lease_generation) || attempt.lease_generation < 0) {
        throw new Error('remote_bridge_invalid_lease_generation');
      }

      return request(
        'cancel',
        `${bridgeUrl}/harness/attempts/${encodeURIComponent(attempt.id)}/cancel`,
        {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({
            lease_owner: attempt.lease_owner,
            lease_generation: attempt.lease_generation,
          }),
        },
        (response, signal) => {
          if (response?.status === 404) {
            return { status: 'missing', httpStatus: 404 };
          }
          if (response?.status === 409) {
            return { status: 'rejected', httpStatus: 409 };
          }
          if (!response?.ok) {
            throw new Error(`remote_bridge_cancel_http_${String(response?.status)}`);
          }
          return parseJson(response, 'cancel', signal);
        },
      );
    },
  });
}
