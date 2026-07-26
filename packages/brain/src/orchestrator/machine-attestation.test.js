import { describe, expect, it } from 'vitest';

import {
  signMachineAttestation,
  verifyMachineAttestation,
} from './machine-attestation.js';

const SECRET = 'x'.repeat(32);
const SIGNING_INPUT = {
  secret: SECRET,
  attemptId: 'attempt-a',
  machineId: 'xian-mac-m4',
  jobId: 'job-1',
};

describe('machine attestation', () => {
  it('signs the exact canonical UTF-8 payload with lowercase HMAC SHA-256 hex', () => {
    expect(signMachineAttestation(SIGNING_INPUT)).toBe(
      '8a7ac46ac24fea34656cad4b3a40839ee30b250304ff14830bd41bcd7ba6537c',
    );
  });

  it('verifies an attestation for the same attempt, machine, and job', () => {
    const attestation = signMachineAttestation(SIGNING_INPUT);

    expect(verifyMachineAttestation({
      ...SIGNING_INPUT,
      attestation,
    })).toBe(true);
  });

  it.each([
    ['attempt', { attemptId: 'attempt-b' }],
    ['machine', { machineId: 'xian-mac-m1' }],
    ['job', { jobId: 'job-2' }],
  ])('rejects an attestation copied to another %s', (_component, replacement) => {
    const attestation = signMachineAttestation(SIGNING_INPUT);

    expect(verifyMachineAttestation({
      ...SIGNING_INPUT,
      ...replacement,
      attestation,
    })).toBe(false);
  });

  it.each([
    ['uppercase hex', (valid) => valid.toUpperCase()],
    ['non-hex characters', () => 'g'.repeat(64)],
    ['too short', (valid) => valid.slice(0, -2)],
    ['too long', (valid) => `${valid}00`],
    ['empty string', () => ''],
    ['non-string', () => Buffer.alloc(32)],
    ['null', () => null],
  ])('returns false for malformed attestation: %s', (_case, makeAttestation) => {
    const valid = signMachineAttestation(SIGNING_INPUT);

    expect(verifyMachineAttestation({
      ...SIGNING_INPUT,
      attestation: makeAttestation(valid),
    })).toBe(false);
  });

  it.each([
    ['secret', { ...SIGNING_INPUT, secret: 'x'.repeat(31) }],
    ['secret', { ...SIGNING_INPUT, secret: Buffer.alloc(32) }],
    ['attemptId', { ...SIGNING_INPUT, attemptId: '' }],
    ['attemptId', { ...SIGNING_INPUT, attemptId: 42 }],
    ['attemptId', { ...SIGNING_INPUT, attemptId: 'attempt\na' }],
    ['attemptId', { ...SIGNING_INPUT, attemptId: 'attempt\ra' }],
    ['machineId', { ...SIGNING_INPUT, machineId: '' }],
    ['machineId', { ...SIGNING_INPUT, machineId: null }],
    ['machineId', { ...SIGNING_INPUT, machineId: 'xian\nmac' }],
    ['machineId', { ...SIGNING_INPUT, machineId: 'xian\rmac' }],
    ['jobId', { ...SIGNING_INPUT, jobId: '' }],
    ['jobId', { ...SIGNING_INPUT, jobId: {} }],
    ['jobId', { ...SIGNING_INPUT, jobId: 'job\n1' }],
    ['jobId', { ...SIGNING_INPUT, jobId: 'job\r1' }],
  ])('rejects invalid signing input for %s', (component, input) => {
    expect(() => signMachineAttestation(input)).toThrow(`invalid_machine_attestation_${component}`);
  });

  it.each([
    ['secret', { ...SIGNING_INPUT, secret: 'short' }],
    ['attemptId', { ...SIGNING_INPUT, attemptId: '' }],
    ['attemptId', { ...SIGNING_INPUT, attemptId: 'attempt\na' }],
    ['attemptId', { ...SIGNING_INPUT, attemptId: 'attempt\ra' }],
    ['machineId', { ...SIGNING_INPUT, machineId: undefined }],
    ['machineId', { ...SIGNING_INPUT, machineId: 'xian\nmac' }],
    ['machineId', { ...SIGNING_INPUT, machineId: 'xian\rmac' }],
    ['jobId', { ...SIGNING_INPUT, jobId: [] }],
    ['jobId', { ...SIGNING_INPUT, jobId: 'job\n1' }],
    ['jobId', { ...SIGNING_INPUT, jobId: 'job\r1' }],
  ])('rejects invalid verification input for %s', (component, input) => {
    expect(() => verifyMachineAttestation({
      ...input,
      attestation: '0'.repeat(64),
    })).toThrow(`invalid_machine_attestation_${component}`);
  });

  it('rejects newline-shifted machine and job boundaries instead of signing colliding tuples', () => {
    const shiftedIntoMachine = {
      ...SIGNING_INPUT,
      machineId: 'xian-mac-m4\njob-prefix',
      jobId: 'job-suffix',
    };
    const shiftedIntoJob = {
      ...SIGNING_INPUT,
      machineId: 'xian-mac-m4',
      jobId: 'job-prefix\njob-suffix',
    };

    expect(() => signMachineAttestation(shiftedIntoMachine))
      .toThrow('invalid_machine_attestation_machineId');
    expect(() => signMachineAttestation(shiftedIntoJob))
      .toThrow('invalid_machine_attestation_jobId');
    expect(() => verifyMachineAttestation({
      ...shiftedIntoMachine,
      attestation: '0'.repeat(64),
    })).toThrow('invalid_machine_attestation_machineId');
    expect(() => verifyMachineAttestation({
      ...shiftedIntoJob,
      attestation: '0'.repeat(64),
    })).toThrow('invalid_machine_attestation_jobId');
  });
});
