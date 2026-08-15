import { createHash } from 'node:crypto';

import { resolveGitHubToken } from '../harness-credentials.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^cp-[a-z0-9][a-z0-9._-]{0,126}$/;
const SUCCESS_STATUSES = new Set(['completed', 'completed_with_concerns']);
const REMOTE_TRANSPORTS = new Set(['fleet-worker', 'remote-bridge']);
const MAX_BLOB_BYTES = 512 * 1024;
const METHOD = 'remote_exact_commit_blob';
const REGULAR_BLOB_MODES = new Set(['100644', '100755']);
const RETRYABLE_GITHUB_STATUSES = new Set([401, 403, 429]);

function recoveryError(message, status = 409, cause) {
  const error = new Error(message);
  error.status = status;
  if (cause) error.cause = cause;
  return error;
}

function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeSprintPath(sprintDir) {
  if (
    typeof sprintDir !== 'string'
    || !sprintDir.startsWith('sprints/')
    || sprintDir.startsWith('/')
    || sprintDir.includes('\\')
    || sprintDir.endsWith('/')
  ) return null;
  const segments = sprintDir.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  if (segments.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment))) return null;
  return `${sprintDir}/sprint-prd.md`;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function githubFetch(url, { accept = 'application/vnd.github+json' } = {}) {
  let response;
  try {
    const token = await resolveGitHubToken();
    response = await fetch(url, {
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
  } catch (cause) {
    throw recoveryError('planner_recovery_exact_blob_unavailable', 503, cause);
  }
  if (!response?.ok) {
    const status = Number(response?.status);
    if (RETRYABLE_GITHUB_STATUSES.has(status)) {
      throw recoveryError('planner_recovery_exact_blob_unavailable', 503);
    }
    if (status === 404) {
      throw recoveryError('planner_recovery_git_object_not_found', 409);
    }
    if (status >= 400 && status < 500) {
      throw recoveryError('planner_recovery_git_object_rejected', 409);
    }
    throw recoveryError('planner_recovery_exact_blob_unavailable', 503);
  }
  return response;
}

async function githubJson(url) {
  const response = await githubFetch(url);
  try {
    return await response.json();
  } catch (cause) {
    throw recoveryError('planner_recovery_git_object_invalid', 409, cause);
  }
}

async function readBoundedBlob(response) {
  const contentLength = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BLOB_BYTES) {
    if (typeof response?.body?.cancel === 'function') {
      await response.body.cancel().catch(() => {});
    }
    throw recoveryError('planner_recovery_blob_too_large');
  }
  if (!response?.body?.getReader) {
    throw recoveryError('planner_recovery_exact_blob_unavailable', 503);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw recoveryError('planner_recovery_blob_invalid');
      }
      byteLength += value.byteLength;
      if (byteLength > MAX_BLOB_BYTES) {
        await reader.cancel().catch(() => {});
        throw recoveryError('planner_recovery_blob_too_large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A failed or cancelled stream can already have released its lock.
    }
  }
  return Buffer.concat(chunks, byteLength);
}

export async function defaultExactBranchHeadResolver({ repo, branch }) {
  const response = await githubFetch(
    `https://api.github.com/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
  );
  return response.json().then((body) => body?.object?.sha ?? null);
}

export async function defaultExactCommitDiffResolver({ repo, baseSha, headSha }) {
  const response = await githubFetch(
    `https://api.github.com/repos/${repo}/compare/${baseSha}...${headSha}`,
  );
  const body = await response.json();
  return {
    isAncestor: ['ahead', 'identical'].includes(body?.status),
    changedFiles: Array.isArray(body?.files)
      ? body.files.map((file) => ({
          path: file?.filename,
          status: file?.status,
          previousPath: file?.previous_filename,
        }))
      : null,
  };
}

export async function defaultExactCommitPathResolver({ repo, headSha, path }) {
  const commit = await githubJson(
    `https://api.github.com/repos/${repo}/git/commits/${headSha}`,
  );
  const treeSha = commit?.tree?.sha;
  if (!SHA_PATTERN.test(treeSha ?? '')) {
    throw recoveryError('planner_recovery_git_object_invalid');
  }
  const tree = await githubJson(
    `https://api.github.com/repos/${repo}/git/trees/${treeSha}?recursive=1`,
  );
  if (tree?.truncated === true || !Array.isArray(tree?.tree)) {
    throw recoveryError('planner_recovery_git_object_invalid');
  }
  const entry = tree.tree.find((candidate) => candidate?.path === path);
  if (!entry) throw recoveryError('planner_recovery_git_object_not_found');
  return { sha: entry.sha, type: entry.type, mode: entry.mode };
}

export async function defaultExactBlobReader({ repo, blobSha }) {
  const response = await githubFetch(
    `https://api.github.com/repos/${repo}/git/blobs/${blobSha}`,
    { accept: 'application/vnd.github.raw+json' },
  );
  return readBoundedBlob(response);
}

function sanitizeResult(result, receiptSummary, artifact) {
  const unrelatedArtifacts = Array.isArray(result?.artifacts)
    ? result.artifacts.filter((candidate) => (
        candidate?.type !== 'git_artifact' && candidate?.kind !== 'planner_prd'
      ))
    : [];
  return {
    ...result,
    artifacts: [...unrelatedArtifacts, artifact],
    server_verification: {
      planner_git_artifact: {
        method: 'git_branch_head',
        artifact: {
          repo: artifact.repo,
          path: artifact.path,
          branch: artifact.branch,
          head_sha: artifact.head_sha,
        },
      },
      planner_recovery_receipt: receiptSummary,
    },
  };
}

export async function resolveRemoteExactCommitBlob(
  { attempt, result },
  {
    resolveBranchHead = defaultExactBranchHeadResolver,
    resolveCommitDiff = defaultExactCommitDiffResolver,
    resolveCommitPathEntry = defaultExactCommitPathResolver,
    readBlobBySha = defaultExactBlobReader,
    now = () => new Date(),
  } = {},
) {
  if (attempt?.role !== 'planner' || !SUCCESS_STATUSES.has(result?.status)) {
    return { sanitizedResult: result, exactEvidence: null };
  }
  if (!REMOTE_TRANSPORTS.has(attempt.execution_transport)) {
    return { sanitizedResult: result, exactEvidence: null };
  }
  if (
    attempt.machine_attestation_status !== 'verified'
    || typeof attempt.requested_machine_id !== 'string'
    || !attempt.requested_machine_id
    || attempt.actual_machine_id !== attempt.requested_machine_id
  ) {
    throw recoveryError('planner_recovery_remote_attestation_invalid');
  }

  const bundle = asObject(attempt.task_bundle);
  const inputs = asObject(bundle.inputs);
  const workspace = asObject(inputs.workspace_spec);
  const repo = workspace.repo;
  const baseSha = workspace.base_sha;
  const branch = inputs.planner_branch;
  const prdPath = safeSprintPath(inputs.sprint_dir);
  if (
    !REPO_PATTERN.test(repo ?? '')
    || !SHA_PATTERN.test(baseSha ?? '')
    || !BRANCH_PATTERN.test(branch ?? '')
    || !prdPath
  ) {
    throw recoveryError('planner_recovery_authority_invalid');
  }

  let rawHead;
  let diff;
  let rawBlob;
  try {
    rawHead = await resolveBranchHead({ repo, branch });
    const headSha = typeof rawHead === 'string' ? rawHead : rawHead?.head_sha;
    if (!SHA_PATTERN.test(headSha ?? '')) {
      throw recoveryError('planner_recovery_head_invalid');
    }
    diff = await resolveCommitDiff({ repo, baseSha, headSha });
    if (diff?.isAncestor !== true) {
      throw recoveryError('planner_recovery_base_not_ancestor');
    }
    if (!Array.isArray(diff.changedFiles)) {
      throw recoveryError('planner_recovery_diff_invalid');
    }
    const entries = diff.changedFiles;
    if (entries.some((entry) => (
      !entry || typeof entry.path !== 'string' || entry.status === 'renamed' || entry.previousPath
    ))) {
      throw recoveryError('planner_recovery_diff_invalid');
    }
    const changedFiles = [...new Set(entries.map((entry) => entry.path))].sort();
    if (entries.length !== 1 || changedFiles.length !== 1 || changedFiles[0] !== prdPath) {
      throw recoveryError('planner_recovery_diff_not_exact_prd');
    }
    const entry = await resolveCommitPathEntry({ repo, headSha, path: prdPath });
    if (
      !SHA_PATTERN.test(entry?.sha ?? '')
      || entry?.type !== 'blob'
      || !REGULAR_BLOB_MODES.has(entry?.mode)
    ) {
      throw recoveryError('planner_recovery_blob_entry_invalid');
    }
    rawBlob = await readBlobBySha({ repo, blobSha: entry.sha });
    if (!(rawBlob instanceof Uint8Array)) {
      throw recoveryError('planner_recovery_blob_invalid');
    }
    const bytes = Buffer.from(rawBlob);
    if (bytes.byteLength > MAX_BLOB_BYTES) {
      throw recoveryError('planner_recovery_blob_too_large');
    }
    let content;
    try {
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch (cause) {
      throw recoveryError('planner_recovery_blob_utf8_invalid', 409, cause);
    }
    if (!content.trim()) throw recoveryError('planner_recovery_blob_empty');

    const changedFilesDigest = sha256(Buffer.from(JSON.stringify(changedFiles)));
    const contentSha256 = sha256(bytes);
    const summary = {
      head_sha: headSha,
      content_sha256: contentSha256,
      byte_length: bytes.byteLength,
      changed_files_digest: changedFilesDigest,
      verification_method: METHOD,
    };
    const verifiedArtifact = {
      type: 'git_artifact',
      kind: 'planner_prd',
      repo,
      path: prdPath,
      branch,
      head_sha: headSha,
      verification_status: 'verified',
    };
    return {
      sanitizedResult: sanitizeResult(result, summary, verifiedArtifact),
      exactEvidence: Object.freeze({
        repo,
        base_sha: baseSha,
        head_sha: headSha,
        prd_path: prdPath,
        resolved_branch: branch,
        content,
        content_sha256: contentSha256,
        byte_length: bytes.byteLength,
        changed_files: Object.freeze(changedFiles),
        changed_files_digest: changedFilesDigest,
        verification_method: METHOD,
        verified_at: now().toISOString(),
      }),
    };
  } catch (error) {
    if (error?.status) throw error;
    throw recoveryError('planner_recovery_exact_blob_unavailable', 503, error);
  }
}
