import { createHash } from 'node:crypto';
import { parseBaseRepo } from './github-pr-discovery.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const MAX_TEST_FILES = 100;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024;

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function validSprintDir(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').includes('..');
}

export function validateFrozenContractArtifacts(artifacts, approvedSha) {
  if (!SHA_PATTERN.test(approvedSha ?? '') || !Array.isArray(artifacts) || artifacts.length === 0) {
    return false;
  }
  return artifacts.every((artifact) => (
    artifact?.type === 'frozen_contract_test'
    && typeof artifact.path === 'string'
    && typeof artifact.content === 'string'
    && DIGEST_PATTERN.test(artifact.sha256 ?? '')
    && artifact.source_sha === approvedSha
    && digest(artifact.content) === artifact.sha256
  ));
}

export function collectFrozenContractArtifacts({
  approvedSha,
  sprintDir,
  repo = null,
  listGitFiles,
  readGitFile,
}) {
  if (!SHA_PATTERN.test(approvedSha ?? '')) {
    throw new Error('frozen_contract_approved_sha_invalid');
  }
  if (!validSprintDir(sprintDir)) {
    throw new Error('frozen_contract_sprint_dir_invalid');
  }
  if (typeof listGitFiles !== 'function' || typeof readGitFile !== 'function') {
    throw new Error('frozen_contract_reader_missing');
  }
  const prefix = `${sprintDir.replace(/\/$/, '')}/tests/`;
  const files = [...new Set(listGitFiles(approvedSha, prefix, { repo }))]
    .filter((filePath) => typeof filePath === 'string' && filePath.startsWith(prefix))
    .sort();
  if (files.length === 0) throw new Error('frozen_contract_tests_missing');
  if (files.length > MAX_TEST_FILES) throw new Error('frozen_contract_tests_limit_exceeded');

  let totalBytes = 0;
  const artifacts = files.map((filePath) => {
    const content = readGitFile(approvedSha, filePath, { repo });
    if (typeof content !== 'string') {
      throw new Error(`frozen_contract_test_unreadable:${filePath}`);
    }
    const bytes = Buffer.byteLength(content);
    totalBytes += bytes;
    if (bytes > MAX_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('frozen_contract_tests_limit_exceeded');
    }
    return Object.freeze({
      type: 'frozen_contract_test',
      path: filePath,
      content,
      sha256: digest(content),
      source_sha: approvedSha,
    });
  });
  return Object.freeze(artifacts);
}

function approvedShaFromObserved(observed, contract) {
  if (SHA_PATTERN.test(contract?.approved_sha ?? '')) return contract.approved_sha;
  const version = Number(contract?.version);
  return [...(observed?.decisionLog ?? [])]
    .reverse()
    .map((row) => row?.detail ?? {})
    .find((detail) => (
      detail?.verdict === 'APPROVED'
      && Number(detail.rn) === version
      && SHA_PATTERN.test(detail.contract_sha ?? '')
    ))?.contract_sha ?? null;
}

export function createFrozenContractArtifactResolver({
  readGitFile,
  listGitFiles,
}) {
  return async ({ ctx }) => {
    const contract = ctx?.observed?.contract?.row;
    if (!contract?.id) throw new Error('frozen_contract_row_missing');
    const approvedSha = approvedShaFromObserved(ctx.observed, contract);
    if (!approvedSha) throw new Error('frozen_contract_approved_sha_missing');
    if (validateFrozenContractArtifacts(contract.frozen_artifacts, approvedSha)) {
      return contract.frozen_artifacts;
    }
    if (Array.isArray(contract.frozen_artifacts) && contract.frozen_artifacts.length > 0) {
      throw new Error('frozen_contract_artifacts_invalid');
    }
    const payload = ctx.observed.task?.payload ?? {};
    const requestedRepo = payload.base_repo;
    const repo = parseBaseRepo(requestedRepo);
    if (requestedRepo != null && requestedRepo !== '' && repo == null) {
      throw new Error('frozen_contract_repo_invalid');
    }
    const artifacts = collectFrozenContractArtifacts({
      approvedSha,
      sprintDir: payload.sprint_dir,
      repo,
      listGitFiles,
      readGitFile,
    });
    return artifacts;
  };
}
