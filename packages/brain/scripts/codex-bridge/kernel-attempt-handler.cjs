'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID: nodeRandomUUID } = require('crypto');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class KernelAttemptError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'KernelAttemptError';
    this.statusCode = statusCode;
  }
}

function claimPath(stateDir, attemptId) {
  if (!UUID_PATTERN.test(String(attemptId ?? ''))) {
    throw new KernelAttemptError('invalid_attempt_id', 422);
  }
  return path.join(stateDir, `${attemptId}.json`);
}

function readClaim(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function writeClaimAtomic(filePath, claim) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${nodeRandomUUID()}.tmp`;
  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(fileDescriptor, `${JSON.stringify(claim)}\n`);
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    const directoryDescriptor = fs.openSync(path.dirname(filePath), 'r');
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } finally {
    if (fileDescriptor !== undefined) fs.closeSync(fileDescriptor);
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function assertMatchingClaim(claim, request) {
  if (
    claim.lease_owner !== request.lease_owner
    || claim.lease_generation !== request.lease_generation
  ) {
    throw new KernelAttemptError('attempt_claim_conflict', 409);
  }
}

function createKernelAttemptHandler({
  stateDir,
  machineId,
  spawnFn,
  randomUUID = nodeRandomUUID,
}) {
  if (!stateDir || !machineId || typeof spawnFn !== 'function') {
    throw new Error('kernel_attempt_handler_invalid_dependencies');
  }

  return {
    async accept(request) {
      const filePath = claimPath(stateDir, request?.attempt_id);
      const existing = readClaim(filePath);
      if (existing) {
        assertMatchingClaim(existing, request);
        return {
          actual_machine_id: existing.machine_id,
          job_id: existing.job_id,
          status: existing.status,
        };
      }

      const claim = {
        attempt_id: request.attempt_id,
        lease_owner: request.lease_owner,
        lease_generation: request.lease_generation,
        job_id: randomUUID(),
        machine_id: machineId,
        status: 'accepted',
      };
      writeClaimAtomic(filePath, claim);
      spawnFn();
      return {
        actual_machine_id: claim.machine_id,
        job_id: claim.job_id,
        status: claim.status,
      };
    },
  };
}

module.exports = {
  KernelAttemptError,
  createKernelAttemptHandler,
};
