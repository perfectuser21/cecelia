import { Buffer } from 'node:buffer';
import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto';

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MACHINES = new Set(['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1']);
const MAX_TOKEN_BYTES = 16_384;

function fail(code) {
  throw new Error(code);
}

function parseDeadline(value, nowMs) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed <= nowMs) {
    fail('github_credential_deadline_invalid');
  }
  return parsed;
}

export function createGitHubCredentialBroker({
  controllerMachineId,
  loadToken,
  now = Date.now,
  randomUUID = nodeRandomUUID,
} = {}) {
  if (typeof loadToken !== 'function') {
    fail('github_credential_loader_required');
  }

  return Object.freeze({
    async issue({
      attemptId,
      machineId,
      deadlineAt,
    } = {}) {
      if (controllerMachineId !== 'us-mac-m4') {
        fail('github_credential_broker_us_authority_required');
      }
      if (!UUID_PATTERN.test(attemptId ?? '')) {
        fail('github_credential_attempt_invalid');
      }
      if (!MACHINES.has(machineId)) {
        fail('github_credential_machine_not_allowed');
      }
      const nowMs = now();
      if (!Number.isFinite(nowMs) || Math.abs(nowMs) > 8_640_000_000_000_000) {
        fail('github_credential_clock_invalid');
      }
      const deadlineMs = parseDeadline(deadlineAt, nowMs);
      let token;
      try {
        const loaded = await loadToken();
        if (typeof loaded !== 'string') {
          fail('github_credential_payload_invalid');
        }
        token = loaded.trim();
      } catch (error) {
        if (error?.message?.startsWith('github_credential_')) throw error;
        fail('github_credential_payload_unavailable');
      }
      if (
        token.length === 0
        || /[\r\n\0]/.test(token)
        || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES
      ) {
        fail('github_credential_payload_invalid');
      }
      const credentialRef = randomUUID();
      if (!UUID_PATTERN.test(credentialRef ?? '')) {
        fail('github_credential_ref_invalid');
      }
      const payloadHash = createHash('sha256').update(token, 'utf8').digest('hex');
      return Object.freeze({
        contract_version: 'github-credential-envelope/v1',
        credential_ref: credentialRef,
        attempt_id: attemptId,
        machine_id: machineId,
        issued_at: new Date(nowMs).toISOString(),
        expires_at: new Date(deadlineMs).toISOString(),
        payload_hash: `sha256:${payloadHash}`,
        payload: Buffer.from(token, 'utf8').toString('base64'),
      });
    },
  });
}
