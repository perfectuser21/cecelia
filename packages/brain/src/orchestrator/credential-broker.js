import { Buffer } from 'node:buffer';
import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';

import { isPrimaryWorker, listComputeWorkerIds } from '../machine-registry.js';

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ACCOUNT_PATTERN = /^team[1-5]$/;
const MACHINES = new Set(listComputeWorkerIds());
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
  trustedUids = [],
  openFile = openSync,
  fstat = fstatSync,
  readFile = readFileSync,
  closeFile = closeSync,
  statDirectory = lstatSync,
  maximumBytes = MAX_AUTH_JSON_BYTES,
} = {}) {
  if (typeof accountHomeResolver !== 'function') {
    fail('credential_account_home_resolver_required');
  }
  if (!Number.isInteger(maximumBytes) || maximumBytes <= 0) {
    fail('credential_source_limit_invalid');
  }
  if (
    !Array.isArray(trustedUids)
    || trustedUids.some((uid) => !Number.isInteger(uid) || uid < 0)
  ) {
    fail('credential_trusted_uids_invalid');
  }
  const trusted = new Set(trustedUids);
  const ownerTrusted = (uid) => !Number.isInteger(uid)
    || typeof process.getuid !== 'function'
    || uid === process.getuid()
    || trusted.has(uid);
  // 凭据由宿主 administrator 的 codex CLI/刷新脚本产出（权限不受本仓库控制，现实为 0644）；
  // loader 只拒绝「可被他人篡改/伪造」的来源：属主须可信，文件与父目录不得被组/他人写，
  // 不得是符号链接，不得带执行位。保密性（0600）由源侧脚本负责。
  const fileModeAcceptable = (mode) => (mode & 0o400) !== 0
    && (mode & 0o022) === 0
    && (mode & 0o111) === 0;

  return async function loadFileCredential(accountId) {
    if (!ACCOUNT_PATTERN.test(accountId ?? '')) {
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
      const parent = statDirectory(accountHome);
      if (
        !parent.isDirectory()
        || parent.isSymbolicLink()
        || !ownerTrusted(parent.uid)
        || (parent.mode & 0o022) !== 0
      ) {
        fail('credential_source_permissions');
      }
      authFile = path.join(accountHome, 'auth.json');
      descriptor = openFile(
        authFile,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      const stat = fstat(descriptor);
      if (
        !stat.isFile()
        || !fileModeAcceptable(stat.mode & 0o777)
        || !ownerTrusted(stat.uid)
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
      if (!isPrimaryWorker(controllerMachineId)) {
        fail('credential_broker_us_authority_required');
      }
      if (!UUID_PATTERN.test(attemptId ?? '')) fail('credential_attempt_invalid');
      if (!ACCOUNT_PATTERN.test(accountId ?? '')) fail('credential_account_not_allowed');
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
        if (typeof error?.message === 'string' && error.message.startsWith('credential_')) throw error;
        fail('credential_payload_invalid');
      }
      if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
        fail('credential_payload_invalid');
      }
      const expiryMs = tokenExpiry(auth);
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
