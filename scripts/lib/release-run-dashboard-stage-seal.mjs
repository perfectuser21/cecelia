#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { digestTree } from './release-run-tree-digest.mjs';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const NONCE_RE = /^[0-9a-f]{64}$/;
const POSITIVE_INT_RE = /^[1-9][0-9]*$/;
const UTC_TIMESTAMP_RE =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
const SAFE_SCALAR_RE = /^[^\t\r\n]+$/;
const REQUIRED_KEYS = Object.freeze([
  'staging_dist',
  'staging_port',
  'slot_pid',
  'slot_nonce',
  'commit',
  'created_at',
  'artifact_name',
  'artifact_version',
  'source_digest',
  'staged_deployed_digest',
]);

function deny(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function fileDigest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function parsePending(path) {
  const stat = lstatSync(path);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.uid !== process.getuid()
    || (stat.mode & 0o777) !== 0o600
  ) {
    deny('release_dashboard_pending_invalid');
  }
  const values = {};
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const separator = line.indexOf('=');
    if (separator <= 0) deny('release_dashboard_pending_invalid');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (
      !REQUIRED_KEYS.includes(key)
      || Object.hasOwn(values, key)
      || !SAFE_SCALAR_RE.test(value)
    ) {
      deny('release_dashboard_pending_invalid');
    }
    values[key] = value;
  }
  if (REQUIRED_KEYS.some((key) => !Object.hasOwn(values, key))) {
    deny('release_dashboard_pending_invalid');
  }
  return values;
}

function assertRegularTree(root) {
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    deny('release_dashboard_staging_tree_invalid');
  }
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const child = lstatSync(path);
    if (child.isSymbolicLink()) deny('release_dashboard_staging_tree_invalid');
    if (child.isDirectory()) assertRegularTree(path);
    else if (!child.isFile()) deny('release_dashboard_staging_tree_invalid');
  }
}

function readBuildSha(root) {
  try {
    const build = JSON.parse(readFileSync(join(root, 'build-info.json'), 'utf8'));
    return typeof build.git_sha === 'string' ? build.git_sha : null;
  } catch {
    return null;
  }
}

export function sealDashboardStage({
  pendingPath,
  stagingRoot,
  sealParent,
  expectedMergeSha,
  expectedArtifactName,
  expectedArtifactVersion,
  expectedSourceDigest,
  afterCopy = () => {},
}) {
  if (
    !pendingPath?.startsWith('/')
    || !stagingRoot?.startsWith('/')
    || !sealParent?.startsWith('/')
    || !SHA_RE.test(expectedMergeSha ?? '')
    || expectedArtifactName !== 'workspace'
    || !SAFE_SCALAR_RE.test(expectedArtifactVersion ?? '')
    || expectedArtifactVersion !== expectedMergeSha.slice(0, 12)
    || !DIGEST_RE.test(expectedSourceDigest ?? '')
  ) {
    deny('release_dashboard_stage_seal_request_invalid');
  }
  const pendingFingerprint = fileDigest(pendingPath);
  const pending = parsePending(pendingPath);
  if (
    resolve(pending.staging_dist) !== resolve(stagingRoot)
    || basename(resolve(stagingRoot)) !== '.dist-staging'
    || pending.commit !== expectedMergeSha
    || pending.artifact_name !== expectedArtifactName
    || pending.artifact_version !== expectedArtifactVersion
    || pending.source_digest !== expectedSourceDigest
    || !DIGEST_RE.test(pending.staged_deployed_digest)
    || !POSITIVE_INT_RE.test(pending.staging_port)
    || Number(pending.staging_port) > 65535
    || !POSITIVE_INT_RE.test(pending.slot_pid)
    || !Number.isSafeInteger(Number(pending.slot_pid))
    || !NONCE_RE.test(pending.slot_nonce)
    || !UTC_TIMESTAMP_RE.test(pending.created_at)
    || !Number.isFinite(Date.parse(pending.created_at))
  ) {
    deny('release_dashboard_stage_identity_mismatch');
  }
  assertRegularTree(stagingRoot);
  if (
    readBuildSha(stagingRoot) !== expectedMergeSha
    || digestTree(stagingRoot) !== pending.staged_deployed_digest
  ) {
    deny('release_dashboard_stage_readback_mismatch');
  }

  const sealedRoot = mkdtempSync(join(resolve(sealParent), '.staging-sealed-'));
  try {
    for (const entry of readdirSync(stagingRoot)) {
      cpSync(join(stagingRoot, entry), join(sealedRoot, entry), {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
      });
    }
    afterCopy({ pendingPath, stagingRoot, sealedRoot });
    assertRegularTree(sealedRoot);
    if (
      digestTree(sealedRoot) !== pending.staged_deployed_digest
      || readBuildSha(sealedRoot) !== expectedMergeSha
      || digestTree(stagingRoot) !== pending.staged_deployed_digest
      || fileDigest(pendingPath) !== pendingFingerprint
    ) {
      deny('release_dashboard_stage_changed_during_seal');
    }
    return {
      sealedRoot,
      stagingPort: pending.staging_port,
      slotPid: pending.slot_pid,
      slotNonce: pending.slot_nonce,
      commit: pending.commit,
      artifactName: pending.artifact_name,
      artifactVersion: pending.artifact_version,
      sourceDigest: pending.source_digest,
      deployedDigest: pending.staged_deployed_digest,
    };
  } catch (error) {
    rmSync(sealedRoot, { recursive: true, force: true });
    throw error;
  }
}

export function readDashboardSlotIdentity(pendingPath) {
  const pending = parsePending(pendingPath);
  if (
    !POSITIVE_INT_RE.test(pending.staging_port)
    || Number(pending.staging_port) > 65535
    || !POSITIVE_INT_RE.test(pending.slot_pid)
    || !Number.isSafeInteger(Number(pending.slot_pid))
    || !NONCE_RE.test(pending.slot_nonce)
    || !SHA_RE.test(pending.commit)
  ) {
    deny('release_dashboard_slot_identity_invalid');
  }
  return {
    stagingPort: pending.staging_port,
    slotPid: pending.slot_pid,
    slotNonce: pending.slot_nonce,
    commit: pending.commit,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.env.RELEASE_DASHBOARD_ACTION === 'read-slot') {
    const identity = readDashboardSlotIdentity(
      process.env.RELEASE_DASHBOARD_PENDING_FILE,
    );
    process.stdout.write([
      identity.stagingPort,
      identity.slotPid,
      identity.slotNonce,
      identity.commit,
    ].join('\t'));
    process.stdout.write('\n');
    process.exit(0);
  }
  const result = sealDashboardStage({
    pendingPath: process.env.RELEASE_DASHBOARD_PENDING_FILE,
    stagingRoot: process.env.RELEASE_DASHBOARD_STAGING_ROOT,
    sealParent: process.env.RELEASE_DASHBOARD_SEAL_PARENT,
    expectedMergeSha: process.env.KERNEL_RELEASE_MERGE_SHA,
    expectedArtifactName: process.env.KERNEL_RELEASE_ARTIFACT_NAME,
    expectedArtifactVersion: process.env.KERNEL_RELEASE_ARTIFACT_VERSION,
    expectedSourceDigest: process.env.KERNEL_RELEASE_ARTIFACT_DIGEST,
  });
  process.stdout.write([
    result.sealedRoot,
    result.stagingPort,
    result.slotPid,
    result.slotNonce,
    result.commit,
    result.artifactName,
    result.artifactVersion,
    result.sourceDigest,
    result.deployedDigest,
  ].join('\t'));
  process.stdout.write('\n');
}
