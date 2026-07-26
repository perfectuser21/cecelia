import { createHmac, timingSafeEqual } from 'node:crypto';

function validateSigningInput({ secret, attemptId, machineId, jobId }) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('invalid_machine_attestation_secret');
  }
  for (const [name, value] of Object.entries({ attemptId, machineId, jobId })) {
    if (typeof value !== 'string' || value.length === 0 || /[\r\n]/.test(value)) {
      throw new Error(`invalid_machine_attestation_${name}`);
    }
  }
}

export function signMachineAttestation({
  secret,
  attemptId,
  machineId,
  jobId,
} = {}) {
  validateSigningInput({ secret, attemptId, machineId, jobId });
  const canonical = `${attemptId}\n${machineId}\n${jobId}`;
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

export function verifyMachineAttestation({
  secret,
  attemptId,
  machineId,
  jobId,
  attestation,
} = {}) {
  validateSigningInput({ secret, attemptId, machineId, jobId });
  if (typeof attestation !== 'string' || !/^[0-9a-f]{64}$/.test(attestation)) {
    return false;
  }

  const expected = Buffer.from(signMachineAttestation({
    secret,
    attemptId,
    machineId,
    jobId,
  }), 'hex');
  const supplied = Buffer.from(attestation, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
