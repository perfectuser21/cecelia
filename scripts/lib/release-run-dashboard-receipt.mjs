#!/usr/bin/env node
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { digestTree } from './release-run-tree-digest.mjs';

const {
  KERNEL_RELEASE_RUN_ID: releaseRunId,
  KERNEL_RELEASE_MERGE_SHA: mergeSha,
  KERNEL_RELEASE_ARTIFACT_DIGEST: artifactDigest,
  KERNEL_RELEASE_ARTIFACT_DEPLOYED_DIGEST: expectedDeployedDigest,
  RELEASE_DASHBOARD_OLD_TAG: oldTag,
  RELEASE_DASHBOARD_NEW_TAG: newTag,
  RELEASE_DASHBOARD_OLD_COMMIT: previousMergeSha,
  RELEASE_DASHBOARD_OLD_ROOT: oldRoot,
  RELEASE_DASHBOARD_NEW_ROOT: newRoot,
  RELEASE_DASHBOARD_RECEIPT: receiptPath,
} = process.env;

if (
  !/^[0-9a-fA-F-]{36}$/.test(releaseRunId ?? '')
  || !/^[0-9a-f]{40}$/.test(mergeSha ?? '')
  || !/^sha256:[0-9a-f]{64}$/.test(artifactDigest ?? '')
  || !/^sha256:[0-9a-f]{64}$/.test(expectedDeployedDigest ?? '')
  || !/^prod-cecelia-v[0-9]+$/.test(oldTag ?? '')
  || !/^prod-cecelia-v[0-9]+$/.test(newTag ?? '')
  || !/^[0-9a-f]{40}$/.test(previousMergeSha ?? '')
  || !oldRoot
  || !newRoot
  || !receiptPath
) {
  throw new Error('release_dashboard_rollback_receipt_request_invalid');
}

let buildSha;
try {
  buildSha = JSON.parse(
    readFileSync(`${newRoot}/build-info.json`, 'utf8'),
  ).git_sha;
} catch {
  buildSha = null;
}
const currentDeployedDigest = digestTree(newRoot);
if (
  buildSha !== mergeSha
  || currentDeployedDigest !== expectedDeployedDigest
  || process.env.KERNEL_RELEASE_ARTIFACT_VERSION !== mergeSha.slice(0, 12)
) {
  throw new Error('release_dashboard_receipt_identity_mismatch');
}

const receipt = {
  schema_version: 1,
  release_run_id: releaseRunId,
  merge_sha: mergeSha,
  artifact_name: 'workspace',
  current_version: process.env.KERNEL_RELEASE_ARTIFACT_VERSION,
  current_digest: artifactDigest,
  current_deployed_digest: currentDeployedDigest,
  old_tag: oldTag,
  new_tag: newTag,
  anchor: `workspace:${artifactDigest}`,
  previous_version: `dashboard:${oldTag}`,
  previous_digest: digestTree(oldRoot),
  previous_merge_sha: previousMergeSha,
};
mkdirSync(dirname(receiptPath), { recursive: true, mode: 0o700 });
const temporaryPath = `${receiptPath}.next-${process.pid}`;
writeFileSync(temporaryPath, JSON.stringify(receipt), { mode: 0o600 });
renameSync(temporaryPath, receiptPath);
chmodSync(receiptPath, 0o600);
