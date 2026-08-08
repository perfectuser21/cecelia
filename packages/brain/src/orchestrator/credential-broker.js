import { Buffer } from 'node:buffer';
import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ACCOUNT_PATTERN = /^team[1-5]$/;
export const CLAUDE_ACCOUNT_PATTERN = /^account[1-9]\d*$/;
const MACHINES = new Set(['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1']);
const MAX_AUTH_JSON_BYTES = 196_608;

function fail(code) {
  throw new Error(code);
}

function tokenExpiry(auth) {
  const token = auth?.tokens?.access_token;
  if (typeof token !== 'string' || token.length === 0) {
    fail('credential_payload_invalid');
  }
  const parts = token.split('.');
  if (parts.length !== 3) fail('credential_expiry_unavailable');
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!Number.isInteger(claims.exp) || claims.exp <= 0) {
      fail('credential_expiry_unavailable');
    }
    return claims.exp * 1000;
  } catch (error) {
    if (error?.message === 'credential_expiry_unavailable') throw error;
    fail('credential_expiry_unavailable');
  }
}

export function claudeTokenExpiry(auth) {
  const expMs = auth?.claudeAiOauth?.expiresAt;
  if (!Number.isInteger(expMs) || expMs <= 0) {
    fail('credential_expiry_unavailable');
  }
  return expMs;
}

function parseDeadline(value, nowMs) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed <= nowMs) {
    fail('credential_deadline_invalid');
  }
  return parsed;
}

function validTimestamp(value) {
  return Number.isFinite(value)
    && Math.abs(value) <= 8_640_000_000_000_000;
}

export function createFileCredentialLoader({
  accountHomeResolver,
  fileName = 'auth.json',
  accountPattern = ACCOUNT_PATTERN,
  openFile = openSync,
  fstat = fstatSync,
  readFile = readFileSync,
  closeFile = closeSync,
  maximumBytes = MAX_AUTH_JSON_BYTES,
} = {}) {
  if (typeof accountHomeResolver !== 'function') {
    fail('credential_account_home_resolver_required');
  }
  if (!Number.isInteger(maximumBytes) || maximumBytes <= 0) {
    fail('credential_source_limit_invalid');
  }

  return async function loadFileCredential(accountId) {
    if (!accountPattern.test(accountId ?? '')) {
      fail('credential_account_not_allowed');
    }
    let authFile;
    let descriptor;
    try {
      const accountHome = accountHomeResolver(accountId);
      if (
        typeof accountHome !== 'string'
        || !path.isAbsolute(accountHome)
        || accountHome === path.parse(accountHome).root
      ) {
        fail('credential_source_path_invalid');
      }
      authFile = path.join(accountHome, fileName);
      descriptor = openFile(
        authFile,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      const stat = fstat(descriptor);
      const permissions = stat.mode & 0o777;
      if (
        !stat.isFile()
        || ![0o400, 0o600].includes(permissions)
        || (
          typeof process.getuid === 'function'
          && Number.isInteger(stat.uid)
          && stat.uid !== process.getuid()
        )
      ) {
        fail('credential_source_permissions');
      }
      if (!Number.isInteger(stat.size) || stat.size <= 0 || stat.size > maximumBytes) {
        fail('credential_source_size_invalid');
      }
      return readFile(descriptor, 'utf8');
    } catch (error) {
      if (error?.message?.startsWith('credential_')) throw error;
      if (['EACCES', 'ELOOP'].includes(error?.code)) {
        fail('credential_source_permissions');
      }
      fail('credential_source_unavailable');
    } finally {
      if (descriptor !== undefined) {
        try {
          closeFile(descriptor);
        } catch {
          // Reading has already finished; never expose filesystem details.
        }
      }
    }
  };
}

export function createCredentialBroker({
  controllerMachineId,
  loadCredential,
  now = Date.now,
  randomUUID = nodeRandomUUID,
  safetyMarginMs = 5 * 60 * 1000,
  accountPattern = ACCOUNT_PATTERN,
  parseExpiry = tokenExpiry,
} = {}) {
  if (typeof loadCredential !== 'function') {
    fail('credential_loader_required');
  }
  if (!Number.isFinite(safetyMarginMs) || safetyMarginMs < 0) {
    fail('credential_margin_invalid');
  }

  return Object.freeze({
    async issue({
      attemptId,
      accountId,
      machineId,
      deadlineAt,
    } = {}) {
      if (controllerMachineId !== 'us-mac-m4') {
        fail('credential_broker_us_authority_required');
      }
      if (!UUID_PATTERN.test(attemptId ?? '')) fail('credential_attempt_invalid');
      if (!accountPattern.test(accountId ?? '')) fail('credential_account_not_allowed');
      if (!MACHINES.has(machineId)) fail('credential_machine_not_allowed');

      const nowMs = now();
      if (!validTimestamp(nowMs)) fail('credential_clock_invalid');
      const deadlineMs = parseDeadline(deadlineAt, nowMs);
      let raw;
      let auth;
      try {
        const loaded = await loadCredential(accountId);
        raw = Buffer.isBuffer(loaded) ? loaded.toString('utf8') : String(loaded);
        if (Buffer.byteLength(raw, 'utf8') > MAX_AUTH_JSON_BYTES) {
          fail('credential_payload_too_large');
        }
        auth = JSON.parse(raw);
      } catch (error) {
        if (error?.message === 'credential_payload_too_large') throw error;
        fail('credential_payload_invalid');
      }
      if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
        fail('credential_payload_invalid');
      }
      const expiryMs = parseExpiry(auth);
      if (!validTimestamp(expiryMs)) fail('credential_expiry_unavailable');
      if (expiryMs < deadlineMs + safetyMarginMs) {
        fail('credential_lifetime_insufficient');
      }
      const credentialRef = randomUUID();
      if (!UUID_PATTERN.test(credentialRef ?? '')) {
        fail('credential_ref_invalid');
      }
      const payloadHash = createHash('sha256').update(raw, 'utf8').digest('hex');
      return Object.freeze({
        contract_version: 'credential-envelope/v1',
        credential_ref: credentialRef,
        attempt_id: attemptId,
        account_id: accountId,
        machine_id: machineId,
        issued_at: new Date(nowMs).toISOString(),
        expires_at: new Date(expiryMs).toISOString(),
        payload_hash: `sha256:${payloadHash}`,
        payload: Buffer.from(raw, 'utf8').toString('base64'),
      });
    },
  });
}

export const __test__ = Object.freeze({ tokenExpiry });
