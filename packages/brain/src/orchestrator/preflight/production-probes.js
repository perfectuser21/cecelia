import { resolveGitHubToken } from '../../harness-credentials.js';
import { resolveCanonicalMachineId } from './canonical-machine-id.js';

const DEFAULT_BRAIN_URL = 'http://127.0.0.1:5221';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 1_000;

function accountRows(snapshot, provider) {
  const rows = snapshot?.vendors?.[provider]?.accounts;
  return Array.isArray(rows) ? rows : [];
}

function boundedSignature(value, fallback) {
  const normalized = String(value ?? fallback).trim();
  return normalized.slice(0, 160) || fallback;
}

/**
 * Thin adapter around state owned by the long-running Brain process.
 * Returned values deliberately exclude credentials and raw response bodies.
 */
export function createProductionCapabilityProbes(deps = {}) {
  const pool = deps.pool;
  const registry = deps.registry;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const resolveGitHubTokenFn = deps.resolveGitHubTokenFn ?? resolveGitHubToken;
  const env = deps.env ?? process.env;
  const brainUrl = String(deps.brainUrl ?? DEFAULT_BRAIN_URL).replace(/\/$/, '');
  const requestTimeoutMs = Number(deps.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const cacheTtlMs = Number(deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  const now = deps.now ?? Date.now;
  const cache = new Map();

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
      const row = await fleetRow(machine);
      return {
        ok: row?.online === true,
        machine,
        signature: row ? (row.online ? null : 'machine_offline') : 'machine_unregistered',
      };
    },

    async getMachineCapacity({ machine }) {
      const row = await fleetRow(machine);
      return {
        ok: row?.online === true,
        available: Math.max(0, Number(row?.effective_slots ?? 0)),
        physical_capacity: Math.max(0, Number(row?.physical_capacity ?? 0)),
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

    async probePostgres() {
      try {
        await pool.query('SELECT 1 AS ok');
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          signature: boundedSignature(error?.code, 'postgres_unreachable'),
        };
      }
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
