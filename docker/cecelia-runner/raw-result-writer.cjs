#!/usr/bin/env node
'use strict';

const {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const { randomBytes } = require('node:crypto');
const { basename, dirname } = require('node:path');

const MAX_RAW_RESULT_BYTES = 1024 * 1024;
const ATTEMPT_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RESULT_ROOT = '/tmp/cecelia-prompts';

function fail(message) {
  throw new Error(`raw_result_writer: ${message}`);
}

function readBoundedStdin() {
  const chunks = [];
  let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    const bytesRead = readSync(0, chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > MAX_RAW_RESULT_BYTES) fail('raw JSON exceeds 1 MiB');
    chunks.push(chunk.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks);
}

function requireManagedTarget() {
  if (!Object.hasOwn(process.env, 'BRAIN_RESULT_FILE')) {
    fail('BRAIN_RESULT_FILE is required');
  }
  const resultFile = process.env.BRAIN_RESULT_FILE;
  if (resultFile.length === 0) fail('BRAIN_RESULT_FILE must not be empty');
  const attemptId = process.env.HARNESS_ATTEMPT_ID ?? '';
  if (!ATTEMPT_ID_PATTERN.test(attemptId)) fail('HARNESS_ATTEMPT_ID is invalid');
  const expected = `${RESULT_ROOT}/${attemptId}.result.json`;
  if (resultFile !== expected) fail('BRAIN_RESULT_FILE path mismatch');
  return resultFile;
}

function requirePrecreatedTarget(resultFile) {
  let target;
  try {
    target = lstatSync(resultFile);
  } catch {
    fail('BRAIN_RESULT_FILE must be a precreated regular file');
  }
  if (!target.isFile() || target.isSymbolicLink()) {
    fail('BRAIN_RESULT_FILE must be a precreated regular file, not a symlink');
  }
  if ((target.mode & 0o777) !== 0o600) {
    fail('BRAIN_RESULT_FILE must have mode 0600');
  }
  return target;
}

function parseRawObject(raw) {
  let value;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    fail('stdin must be valid JSON');
  }
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    fail('stdin JSON must be an object');
  }
  const encoded = Buffer.from(`${JSON.stringify(value)}\n`);
  if (encoded.length > MAX_RAW_RESULT_BYTES) fail('encoded JSON exceeds 1 MiB');
  return encoded;
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function writeAtomically(resultFile, initialTarget, encoded) {
  const resultDir = dirname(resultFile);
  const tempPrefix = `.${basename(resultFile)}.tmp.`;
  let tempFile = null;
  let tempFd = null;
  let dirFd = null;
  try {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = `${resultDir}/${tempPrefix}${process.pid}.${randomBytes(8).toString('hex')}`;
      try {
        const noFollow = constants.O_NOFOLLOW ?? 0;
        tempFd = openSync(
          candidate,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
          0o600,
        );
        tempFile = candidate;
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    if (tempFd == null || tempFile == null) fail('unable to allocate exclusive temp file');
    fchmodSync(tempFd, 0o600);
    writeFileSync(tempFd, encoded);
    fsyncSync(tempFd);
    closeSync(tempFd);
    tempFd = null;

    const currentTarget = requirePrecreatedTarget(resultFile);
    if (!sameInode(initialTarget, currentTarget)) {
      fail('BRAIN_RESULT_FILE inode changed before rename');
    }

    renameSync(tempFile, resultFile);
    tempFile = null;
    dirFd = openSync(resultDir, constants.O_RDONLY);
    fsyncSync(dirFd);
    closeSync(dirFd);
    dirFd = null;
  } finally {
    if (tempFd != null) {
      try { closeSync(tempFd); } catch {}
    }
    if (dirFd != null) {
      try { closeSync(dirFd); } catch {}
    }
    if (tempFile != null) {
      try { unlinkSync(tempFile); } catch {}
    }
  }
}

function main() {
  const resultFile = requireManagedTarget();
  const initialTarget = requirePrecreatedTarget(resultFile);
  const encoded = parseRawObject(readBoundedStdin());
  writeAtomically(resultFile, initialTarget, encoded);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
}
