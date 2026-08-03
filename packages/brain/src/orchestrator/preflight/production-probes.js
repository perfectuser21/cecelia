import { resolveGitHubToken } from '../../harness-credentials.js';
import { createNodeAdmissionClient } from '../fleet-node/node-admission-client.js';
import { getNodeProfile, getRoleCapacity } from '../fleet-node/node-profile.js';
import { resolveCanonicalMachineId } from './canonical-machine-id.js';

const DEFAULT_BRAIN_URL = 'http://127.0.0.1:5221';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_NODE_ADMISSION_TIMEOUT_MS = 20_000;
const DEFAULT_CACHE_TTL_MS = 1_000;

function accountRows(snapshot, provider) {
  const rows = snapshot?.vendors?.[provider]?.accounts;
  return Array.isArray(rows) ? rows : [];
}

function boundedSignature(value, fallback) {
  const normalized = String(value ?? fallback).trim();
  return normalized.slice(0, 160) || fallback;
}

function boundedBaseSlots(value, canonicalCapacity) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(canonicalCapacity, Math.floor(value));
}

/**
 * Thin adapter around state owned by the long-running Brain process.
 * Returned values deliberately exclude credentials and raw response bodies.
 */
export function createProductionCapabilityProbes(deps = {}) {
  const registry = deps.registry;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const resolveGitHubTokenFn = deps.resolveGitHubTokenFn ?? resolveGitHubToken;
  const env = deps.env ?? process.env;
  const brainUrl = String(deps.brainUrl ?? DEFAULT_BRAIN_URL).replace(/\/$/, '');
  const requestTimeoutMs = Number(deps.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const cacheTtlMs = Number(deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  const now = deps.now ?? Date.now;
  const cache = new Map();
  const nodeAdmissionRequestTimeoutMs = Number(
    deps.nodeAdmissionRequestTimeoutMs ?? DEFAULT_NODE_ADMISSION_TIMEOUT_MS,
  );
  const createNodeAdmissionClientFn = deps.createNodeAdmissionClientFn
    ?? createNodeAdmissionClient;
  const nodeAdmissionClient = deps.nodeAdmissionClient ?? createNodeAdmissionClientFn({
    env,
    fetchFn,
    now,
    requestTimeoutMs: nodeAdmissionRequestTimeoutMs,
  });

  async function fetchJson(url, options = {}, { force = false } = {}) {
    const cached = cache.get(url);
    if (!force && cached && cached.expiresAt >= now()) return cached.value;
    const response = await fetchFn(url, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response?.ok) {
      const error = new Error(`http_${response?.status ?? 'unknown'}`);
      error.httpStatus = response?.status ?? null;
      throw error;
    }
    const value = await response.json();
    cache.set(url, { value, expiresAt: now() + cacheTtlMs });
    return value;
  }

  async function fleetSnapshot() {
    return fetchJson(`${brainUrl}/api/brain/capacity-budget`);
  }

  async function llmSnapshot(force = false) {
    return fetchJson(
      `${brainUrl}/api/brain/dispatch/llm-capacity`,
      {},
      { force },
    );
  }

  async function fleetRow(machine) {
    const snapshot = await fleetSnapshot();
    const fleet = Array.isArray(snapshot?.fleet) ? snapshot.fleet : [];
    return fleet.find((row) => row?.id === machine) ?? null;
  }

  async function admittedNode(machine) {
    try {
      const admission = await nodeAdmissionClient.getAdmission(machine, {
        forceFresh: true,
      });
      const baseAdmitted = admission?.base_admitted === true
        && admission?.state === 'base_admitted';
      const dispatchReady = admission?.dispatch_ready === true;
      const admitted = baseAdmitted && dispatchReady;
      const admissionReasons = Array.isArray(admission?.reasons)
        ? admission.reasons
          .map((reason) => String(reason?.code ?? '').slice(0, 64))
          .filter(Boolean)
          .slice(0, 16)
        : [];
      if (baseAdmitted && !dispatchReady) {
        admissionReasons.unshift('node_not_dispatch_ready');
      }
      return {
        admitted,
        admissionReasons,
        runtimeResources: admission?.runtime_resources ?? null,
        signature: baseAdmitted
          ? 'node_not_dispatch_ready'
          : 'node_not_base_admitted',
      };
    } catch {
      return {
        admitted: false,
        admissionReasons: ['node_admission_probe_failed'],
        signature: 'node_not_base_admitted',
      };
    }
  }

  return Object.freeze({
    async resolveCanonicalMachineId() {
      const snapshot = await fleetSnapshot();
      const fleet = Array.isArray(snapshot?.fleet) ? snapshot.fleet : [];
      return resolveCanonicalMachineId({
        envMachineId: env.CECELIA_MACHINE_ID,
        fleetMachineId: env.CECELIA_MACHINE_ID,
        fleet,
      });
    },

    async getMachineHealth({ machine }) {
      const admission = await admittedNode(machine);
      if (!admission.admitted) {
        return {
          ok: false,
          machine,
          signature: admission.signature,
          admission_reasons: admission.admissionReasons,
        };
      }
      const row = await fleetRow(machine);
      return {
        ok: row?.online === true,
        machine,
        signature: row ? (row.online ? null : 'machine_offline') : 'machine_unregistered',
      };
    },

    async getMachineCapacity({ machine, task_bundle: taskBundle }) {
      const admission = await admittedNode(machine);
      if (!admission.admitted) {
        return {
          ok: false,
          available: 0,
          physical_capacity: 0,
          pressure: 1,
          signature: admission.signature,
          admission_reasons: admission.admissionReasons,
        };
      }

      let profile;
      let role;
      try {
        profile = getNodeProfile(machine);
        role = getRoleCapacity({
          baseCapacity: 0,
          role: taskBundle?.role,
        }).role;
      } catch (error) {
        return {
          ok: false,
          available: 0,
          physical_capacity: 0,
          pressure: 1,
          signature: error?.message === 'unknown_fleet_node'
            ? 'unknown_fleet_node'
            : 'unknown_fleet_role',
        };
      }

      const row = await fleetRow(machine);
      const effectiveBaseSlots = boundedBaseSlots(
        row?.effective_slots,
        profile.capacity,
      );
      const physicalBaseSlots = boundedBaseSlots(
        row?.physical_capacity,
        profile.capacity,
      );
      const availableCapacity = getRoleCapacity({
        baseCapacity: effectiveBaseSlots,
        role,
      });
      const physicalCapacity = getRoleCapacity({
        baseCapacity: physicalBaseSlots,
        role,
      });
      return {
        ok: row?.online === true,
        available: availableCapacity.capacity,
        physical_capacity: physicalCapacity.capacity,
        role,
        role_weight: availableCapacity.weight,
        effective_base_slots: effectiveBaseSlots,
        physical_base_slots: physicalBaseSlots,
        pressure: Number(row?.pressure ?? 1),
        signature: row ? (row.online ? null : 'machine_offline') : 'machine_unregistered',
      };
    },

    async listProviderAccounts({ provider }) {
      const snapshot = await llmSnapshot();
      return accountRows(snapshot, provider)
        .map((row) => row?.name)
        .filter(Boolean);
    },

    async probeProviderAuth({ provider, account, recovery_retry: recoveryRetry = false }) {
      const snapshot = await llmSnapshot(recoveryRetry);
      const row = accountRows(snapshot, provider)
        .find((candidate) => candidate?.name === account);
      if (!row) {
        return {
          ok: false,
          provider,
          account,
          signature: 'credential_missing',
        };
      }
      return {
        ok: row.available === true,
        provider,
        account,
        source: boundedSignature(row.source, 'unknown'),
        ...(row.available === true
          ? {}
          : { signature: boundedSignature(row.source, 'provider_auth_unavailable') }),
      };
    },

    async probeGitHub() {
      let token;
      try {
        token = await resolveGitHubTokenFn();
      } catch {
        return { ok: false, signature: 'github_token_unavailable' };
      }
      try {
        const response = await fetchFn('https://api.github.com/user', {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'User-Agent': 'cecelia-kernel-capability-probe',
          },
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        if (!response.ok) {
          return {
            ok: false,
            signature: `github_http_${response.status}`,
            http_status: response.status,
          };
        }
        const body = await response.json();
        return {
          ok: typeof body?.login === 'string' && body.login.length > 0,
          login: typeof body?.login === 'string' ? body.login : null,
          ...(body?.login ? {} : { signature: 'github_identity_missing' }),
        };
      } catch (error) {
        return {
          ok: false,
          signature: boundedSignature(error?.message, 'github_probe_error'),
        };
      }
    },

    async probePostgres({ target } = {}) {
      const admission = await admittedNode(target?.machine);
      if (!admission.admitted) {
        return {
          ok: false,
          signature: admission.signature,
          admission_reasons: admission.admissionReasons,
        };
      }
      const postgres = admission.runtimeResources?.postgres;
      if (postgres?.available !== true || typeof postgres.image_digest !== 'string') {
        return { ok: false, signature: 'postgres_runtime_unavailable' };
      }
      return { ok: true, image_digest: postgres.image_digest };
    },

    async probeModelCapability({ capability, target }) {
      try {
        const adapter = registry.get(target?.provider);
        const ok = adapter.capabilities.includes(capability);
        return {
          ok,
          capability,
          ...(ok ? {} : { signature: 'model_capability_missing' }),
        };
      } catch {
        return {
          ok: false,
          capability,
          signature: 'provider_adapter_unavailable',
        };
      }
    },
  });
}
