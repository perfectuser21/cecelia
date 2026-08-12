import { createHash } from 'node:crypto';
import path from 'node:path';

export const CONTRACT_ARTIFACT_MAX_BYTES = 256 * 1024;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export function assertContractArtifactPath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\0')
    || value.includes('\\')
    || path.posix.isAbsolute(value)
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`FROZEN_CONTRACT_ARTIFACT_INVALID:path:${String(value)}`);
  }
  return value;
}

function artifactFor(pathValue, content, sourceRevision) {
  const artifactPath = assertContractArtifactPath(pathValue);
  if (typeof content !== 'string') {
    throw new Error(`FROZEN_CONTRACT_ARTIFACT_INVALID:content:${artifactPath}`);
  }
  return Object.freeze({
    path: artifactPath,
    content,
    sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    byte_length: Buffer.byteLength(content, 'utf8'),
    source_revision: sourceRevision,
  });
}

export function validateContractArtifacts(artifacts, {
  requireTests = false,
  maxBytes = CONTRACT_ARTIFACT_MAX_BYTES,
} = {}) {
  if (!Array.isArray(artifacts)) {
    throw new Error('FROZEN_CONTRACT_ARTIFACT_INVALID:not_array');
  }
  let totalBytes = 0;
  let previousPath = null;
  let testCount = 0;
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new Error('FROZEN_CONTRACT_ARTIFACT_INVALID:shape');
    }
    const artifactPath = assertContractArtifactPath(artifact.path);
    if (previousPath != null && artifactPath <= previousPath) {
      throw new Error('FROZEN_CONTRACT_ARTIFACT_INVALID:order_or_duplicate');
    }
    previousPath = artifactPath;
    if (typeof artifact.content !== 'string') {
      throw new Error(`FROZEN_CONTRACT_ARTIFACT_INVALID:content:${artifactPath}`);
    }
    const actualLength = Buffer.byteLength(artifact.content, 'utf8');
    const actualDigest = createHash('sha256').update(artifact.content, 'utf8').digest('hex');
    if (
      !DIGEST_PATTERN.test(artifact.sha256 ?? '')
      || artifact.sha256 !== actualDigest
      || !Number.isSafeInteger(artifact.byte_length)
      || artifact.byte_length !== actualLength
      || !SHA_PATTERN.test(artifact.source_revision ?? '')
    ) {
      throw new Error(`FROZEN_CONTRACT_ARTIFACT_INVALID:integrity:${artifactPath}`);
    }
    totalBytes += actualLength;
    if (totalBytes > maxBytes) {
      throw new Error(`FROZEN_CONTRACT_ARTIFACT_SIZE_LIMIT:${totalBytes}`);
    }
    if (artifactPath.includes('/tests/')) testCount++;
  }
  if (requireTests && testCount === 0) {
    throw new Error('FROZEN_CONTRACT_ARTIFACTS_MISSING:tests');
  }
  return Object.freeze([...artifacts]);
}

export function collectApprovedContractArtifacts({
  sourceRevision,
  sprintDir,
  prdPath = `${sprintDir}/sprint-prd.md`,
  repo = null,
  readGitFile,
  listGitFiles,
}) {
  if (!SHA_PATTERN.test(sourceRevision ?? '')) {
    throw new Error('FROZEN_CONTRACT_ARTIFACT_INVALID:source_revision');
  }
  assertContractArtifactPath(sprintDir);
  if (typeof readGitFile !== 'function' || typeof listGitFiles !== 'function') {
    throw new Error('FROZEN_CONTRACT_ARTIFACTS_MISSING:reader');
  }
  const requiredPaths = [
    prdPath,
    `${sprintDir}/contract-draft.md`,
    `${sprintDir}/contract-dod.md`,
  ];
  let testPaths;
  try {
    testPaths = listGitFiles(sourceRevision, `${sprintDir}/tests`, { repo });
  } catch (error) {
    throw new Error(`FROZEN_CONTRACT_ARTIFACTS_MISSING:tests:${error.message}`);
  }
  if (!Array.isArray(testPaths) || testPaths.length === 0) {
    throw new Error('FROZEN_CONTRACT_ARTIFACTS_MISSING:tests');
  }
  const optionalPath = `${sprintDir}/task-plan.md`;
  const candidatePaths = [...requiredPaths, optionalPath, ...testPaths];
  const uniquePaths = [...new Set(candidatePaths)].sort();
  if (uniquePaths.length !== candidatePaths.length) {
    throw new Error('FROZEN_CONTRACT_ARTIFACT_INVALID:duplicate_path');
  }
  const artifacts = [];
  for (const filePath of uniquePaths) {
    assertContractArtifactPath(filePath);
    try {
      artifacts.push(artifactFor(
        filePath,
        readGitFile(sourceRevision, filePath, { repo }),
        sourceRevision,
      ));
    } catch (error) {
      if (filePath === optionalPath) continue;
      if (String(error.message).startsWith('FROZEN_CONTRACT_ARTIFACT_INVALID')) throw error;
      throw new Error(`FROZEN_CONTRACT_ARTIFACTS_MISSING:${filePath}`);
    }
  }
  validateContractArtifacts(artifacts, { requireTests: true });
  const byPath = new Map(artifacts.map((artifact) => [artifact.path, artifact.content]));
  return Object.freeze({
    artifacts: Object.freeze(artifacts),
    prdContent: byPath.get(prdPath),
    contractContent: `${byPath.get(requiredPaths[1])}\n\n${byPath.get(requiredPaths[2])}`,
  });
}
