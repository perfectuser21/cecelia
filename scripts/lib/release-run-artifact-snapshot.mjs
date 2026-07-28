import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { digestTree } from './release-run-tree-digest.mjs';

const RECEIPT_FILE = '.release-snapshot.json';

function readReceipt(snapshotRoot) {
  try {
    return JSON.parse(readFileSync(join(snapshotRoot, RECEIPT_FILE), 'utf8'));
  } catch {
    throw new Error('release_artifact_snapshot_invalid');
  }
}

function validateReceipt(receipt, mergeSha) {
  if (
    receipt?.schema_version !== 1
    || receipt?.merge_sha !== mergeSha
    || receipt?.source !== 'git-archive'
    || !/^sha256:[0-9a-f]{64}$/.test(receipt?.tree_digest ?? '')
  ) {
    throw new Error('release_artifact_snapshot_identity_mismatch');
  }
}

function validateSnapshot(snapshotRoot, mergeSha) {
  const receipt = readReceipt(snapshotRoot);
  validateReceipt(receipt, mergeSha);
  const actualDigest = digestTree(snapshotRoot, { exclude: [RECEIPT_FILE] });
  if (actualDigest !== receipt.tree_digest) {
    throw new Error('release_artifact_snapshot_digest_mismatch');
  }
  return receipt;
}

function makeTreeReadOnly(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) makeTreeReadOnly(join(path, entry));
    chmodSync(path, 0o555);
    return;
  }
  if (stat.isFile()) chmodSync(path, stat.mode & 0o111 ? 0o555 : 0o444);
}

export function prepareReleaseArtifactSnapshot({
  repoRoot,
  artifactStore,
  mergeSha,
  execFile = execFileSync,
} = {}) {
  if (
    !isAbsolute(repoRoot ?? '')
    || !isAbsolute(artifactStore ?? '')
    || !/^[0-9a-f]{40}$/.test(mergeSha ?? '')
  ) {
    throw new Error('release_artifact_snapshot_request_invalid');
  }
  const snapshotRoot = join(artifactStore, mergeSha);
  if (existsSync(snapshotRoot)) {
    validateSnapshot(snapshotRoot, mergeSha);
    makeTreeReadOnly(snapshotRoot);
    return snapshotRoot;
  }

  mkdirSync(artifactStore, { recursive: true, mode: 0o700 });
  const temporaryRoot = mkdtempSync(join(artifactStore, `.${mergeSha}.next-`));
  try {
    const archive = execFile(
      'git',
      ['-C', repoRoot, 'archive', '--format=tar', mergeSha],
      { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 },
    );
    execFile('tar', ['-xf', '-', '-C', temporaryRoot], {
      input: archive,
      maxBuffer: 512 * 1024 * 1024,
    });
    const treeDigest = digestTree(temporaryRoot);
    writeFileSync(
      join(temporaryRoot, RECEIPT_FILE),
      JSON.stringify({
        schema_version: 1,
        merge_sha: mergeSha,
        source: 'git-archive',
        tree_digest: treeDigest,
      }),
      { mode: 0o444 },
    );
    try {
      renameSync(temporaryRoot, snapshotRoot);
      makeTreeReadOnly(snapshotRoot);
    } catch (error) {
      if (!existsSync(snapshotRoot)) throw error;
      validateSnapshot(snapshotRoot, mergeSha);
      if (existsSync(temporaryRoot)) {
        makeTreeWritable(temporaryRoot);
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    }
  } catch (error) {
    if (existsSync(temporaryRoot)) {
      makeTreeWritable(temporaryRoot);
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
    throw error;
  }
  validateSnapshot(snapshotRoot, mergeSha);
  makeTreeReadOnly(snapshotRoot);
  return snapshotRoot;
}

function makeTreeWritable(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const entry of readdirSync(path)) makeTreeWritable(join(path, entry));
    return;
  }
  if (stat.isFile()) chmodSync(path, stat.mode & 0o111 ? 0o700 : 0o600);
}

export function prepareReleaseExecutionWorkspace({
  artifactStore,
  snapshotRoot,
  mergeSha,
} = {}) {
  if (
    !isAbsolute(artifactStore ?? '')
    || !isAbsolute(snapshotRoot ?? '')
    || !/^[0-9a-f]{40}$/.test(mergeSha ?? '')
  ) {
    throw new Error('release_execution_workspace_request_invalid');
  }
  validateSnapshot(snapshotRoot, mergeSha);
  const runsRoot = join(artifactStore, '.runs');
  mkdirSync(runsRoot, { recursive: true, mode: 0o700 });
  const executionRoot = mkdtempSync(join(runsRoot, `${mergeSha}-`));
  try {
    cpSync(snapshotRoot, executionRoot, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    makeTreeWritable(executionRoot);
    validateSnapshot(executionRoot, mergeSha);
    return executionRoot;
  } catch (error) {
    makeTreeWritable(executionRoot);
    rmSync(executionRoot, { recursive: true, force: true });
    throw error;
  }
}

export function cleanupReleaseExecutionWorkspace(executionRoot, { artifactStore } = {}) {
  const runsRoot = join(artifactStore ?? '', '.runs');
  if (
    !isAbsolute(executionRoot ?? '')
    || !isAbsolute(artifactStore ?? '')
    || executionRoot === runsRoot
    || !executionRoot.startsWith(`${runsRoot}/`)
  ) {
    throw new Error('release_execution_workspace_reference_invalid');
  }
  if (!existsSync(executionRoot)) return;
  makeTreeWritable(executionRoot);
  rmSync(executionRoot, { recursive: true, force: true });
}

export const __test__ = {
  makeTreeReadOnly,
  makeTreeWritable,
  readReceipt,
  validateReceipt,
  validateSnapshot,
};
