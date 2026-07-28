import { execFileSync } from 'node:child_process';
import {
  chmodSync,
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

function readReceipt(snapshotRoot) {
  try {
    return JSON.parse(readFileSync(join(snapshotRoot, '.release-snapshot.json'), 'utf8'));
  } catch {
    throw new Error('release_artifact_snapshot_invalid');
  }
}

function validateReceipt(receipt, mergeSha) {
  if (
    receipt?.schema_version !== 1
    || receipt?.merge_sha !== mergeSha
    || receipt?.source !== 'git-archive'
  ) {
    throw new Error('release_artifact_snapshot_identity_mismatch');
  }
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
    validateReceipt(readReceipt(snapshotRoot), mergeSha);
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
    writeFileSync(
      join(temporaryRoot, '.release-snapshot.json'),
      JSON.stringify({
        schema_version: 1,
        merge_sha: mergeSha,
        source: 'git-archive',
      }),
      { mode: 0o444 },
    );
    const workflowSkills = join(temporaryRoot, 'packages/workflows/skills');
    if (existsSync(workflowSkills)) makeTreeReadOnly(workflowSkills);
    try {
      renameSync(temporaryRoot, snapshotRoot);
    } catch (error) {
      if (!existsSync(snapshotRoot)) throw error;
      validateReceipt(readReceipt(snapshotRoot), mergeSha);
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  } catch (error) {
    if (existsSync(temporaryRoot)) {
      chmodSync(temporaryRoot, 0o700);
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
    throw error;
  }
  validateReceipt(readReceipt(snapshotRoot), mergeSha);
  return snapshotRoot;
}

export const __test__ = { makeTreeReadOnly, readReceipt, validateReceipt };
