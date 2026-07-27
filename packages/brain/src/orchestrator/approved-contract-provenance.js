import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const SHA256_RE = /^[a-f0-9]{64}$/;

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function git(repoRoot, args, options = {}) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: options.encoding ?? 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitBuffer(repoRoot, args) {
  return git(repoRoot, args, { encoding: 'buffer' });
}

function normalizeRepoPath(filePath) {
  return String(filePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function gitFileBuffer(repoRoot, commitSha, filePath) {
  return gitBuffer(repoRoot, ['show', `${commitSha}:${normalizeRepoPath(filePath)}`]);
}

function gitFileText(repoRoot, commitSha, filePath) {
  return gitFileBuffer(repoRoot, commitSha, filePath).toString('utf8');
}

function gitPathExists(repoRoot, commitSha, filePath) {
  try {
    git(repoRoot, ['cat-file', '-e', `${commitSha}:${normalizeRepoPath(filePath)}`]);
    return true;
  } catch {
    return false;
  }
}

function gitBlobOid(repoRoot, commitSha, filePath) {
  const output = git(repoRoot, ['ls-tree', commitSha, '--', normalizeRepoPath(filePath)]).trim();
  const match = output.match(/\bblob\s+([a-f0-9]{40,64})\t/);
  if (!match) throw new Error(`approved artifact missing: ${filePath}`);
  return match[1];
}

function gitListFiles(repoRoot, commitSha, dirPath) {
  try {
    return git(repoRoot, ['ls-tree', '-r', '--name-only', commitSha, '--', normalizeRepoPath(dirPath)])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function artifactKind(filePath, fallback = 'fixture') {
  const normalized = normalizeRepoPath(filePath);
  if (normalized === 'DoD.md') return 'root_dod';
  if (/^packages\/brain\/migrations\/\d+_.*\.sql$/.test(normalized)) return 'migration';
  if (normalized.endsWith('/sprint-prd.md')) return 'prd';
  if (normalized.endsWith('/contract-draft.md')) return 'contract_draft';
  if (normalized.endsWith('/contract-dod.md')) return 'contract_dod';
  if (normalized.endsWith('/task-plan.json')) return 'task_plan';
  if (/\/tests\/.*\.(test|spec)\.[jt]s$/.test(normalized)) return 'test';
  if (/\/golden\//.test(normalized) || /golden/i.test(path.basename(normalized))) return 'golden';
  if (/\/fixtures?\//.test(normalized)) return 'fixture';
  return fallback;
}

function migrationNumber(filePath) {
  const match = normalizeRepoPath(filePath).match(/\/(\d+)_([^/]+)\.sql$/);
  return match ? Number(match[1]) : null;
}

function sortByPath(values) {
  return [...new Set(values.map(normalizeRepoPath).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function extractReferencedPaths(text, sprintDir) {
  const paths = [];
  const source = String(text ?? '');
  const directPath = /(?:^|[\s"'`(])((?:\$\{SPRINT_DIR\}|sprints)\/[^"'`\s)]*(?:fixtures?|golden)\/[^"'`\s),]+)/g;
  for (const match of source.matchAll(directPath)) {
    const raw = match[1].replace(/^\$\{SPRINT_DIR\}/, sprintDir);
    paths.push(raw.replace(/[.,;:]+$/, ''));
  }
  const labeled = /(?:Fixture|Golden):\s*([^\s)]+)/gi;
  for (const match of source.matchAll(labeled)) {
    paths.push(match[1].replace(/^\$\{SPRINT_DIR\}/, sprintDir).replace(/[.,;:]+$/, ''));
  }
  return paths.map(normalizeRepoPath);
}

function referencedFixturePaths(repoRoot, commitSha, sprintDir, sourcePaths) {
  const refs = [];
  for (const filePath of sourcePaths) {
    if (!gitPathExists(repoRoot, commitSha, filePath)) continue;
    refs.push(...extractReferencedPaths(gitFileText(repoRoot, commitSha, filePath), sprintDir));
  }
  return sortByPath(refs).filter((filePath) => gitPathExists(repoRoot, commitSha, filePath));
}

function rootDodMigrationPaths(repoRoot, commitSha) {
  if (!gitPathExists(repoRoot, commitSha, 'DoD.md')) return [];
  const content = gitFileText(repoRoot, commitSha, 'DoD.md');
  const matches = [...content.matchAll(/packages\/brain\/migrations\/\d+_[A-Za-z0-9_-]+\.sql/g)]
    .map((match) => match[0]);
  return sortByPath(matches)
    .filter((filePath) => gitPathExists(repoRoot, commitSha, filePath))
    .sort((a, b) => (migrationNumber(a) ?? 0) - (migrationNumber(b) ?? 0) || a.localeCompare(b));
}

function buildArtifact(repoRoot, commitSha, filePath, kind = artifactKind(filePath)) {
  const normalized = normalizeRepoPath(filePath);
  const content = gitFileBuffer(repoRoot, commitSha, normalized);
  return {
    path: normalized,
    git_blob_oid: gitBlobOid(repoRoot, commitSha, normalized),
    sha256: sha256(content),
    size: content.length,
    kind,
  };
}

function normalizeRootDod(content) {
  return String(content ?? '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(Evidence|Provenance):/i.test(line))
    .map((line) => line.replace(/\[[ xX]\]/g, '[ ]').trimEnd())
    .join('\n')
    .trimEnd();
}

function asObject(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function approvedDigestFromContract(contract) {
  const approvedManifest = asObject(contract?.approved_manifest);
  return contract?.manifest_digest ?? approvedManifest?.manifest_digest ?? null;
}

function approvedSourceShaFromContract(contract) {
  const approvedManifest = asObject(contract?.approved_manifest);
  return contract?.source_commit_sha ?? approvedManifest?.source_commit_sha ?? null;
}

function callbackDigest(result) {
  return result?.decision?.manifest_digest
    ?? result?.provider_metadata?.manifest_digest
    ?? result?.decision?.approved_manifest_digest
    ?? null;
}

function rolePrefix(role) {
  return role === 'evaluator' ? 'evaluate' : 'generator';
}

export async function buildApprovedContractManifest({
  repoRoot,
  runId,
  contractVersion,
  sourceCommitSha,
  sprintDir,
  approvedAt,
  reviewerVerdict,
}) {
  if (!repoRoot) throw new Error('repoRoot is required');
  if (!sourceCommitSha) throw new Error('sourceCommitSha is required');
  const normalizedSprintDir = normalizeRepoPath(sprintDir);
  const contractDod = `${normalizedSprintDir}/contract-dod.md`;
  const contractDraft = `${normalizedSprintDir}/contract-draft.md`;
  const sprintPrd = `${normalizedSprintDir}/sprint-prd.md`;
  const taskPlan = `${normalizedSprintDir}/task-plan.json`;
  const testsDir = `${normalizedSprintDir}/tests`;
  const sourcePaths = [
    'DoD.md',
    contractDraft,
    contractDod,
    sprintPrd,
    taskPlan,
    ...gitListFiles(repoRoot, sourceCommitSha, testsDir),
  ];
  const artifactPaths = [
    ...(gitPathExists(repoRoot, sourceCommitSha, 'DoD.md') ? ['DoD.md'] : []),
    ...rootDodMigrationPaths(repoRoot, sourceCommitSha),
    ...referencedFixturePaths(repoRoot, sourceCommitSha, normalizedSprintDir, sourcePaths),
    contractDod,
    contractDraft,
    sprintPrd,
    taskPlan,
    ...gitListFiles(repoRoot, sourceCommitSha, testsDir).sort((a, b) => a.localeCompare(b)),
  ];
  const artifacts = sortByPath(artifactPaths)
    .map((filePath) => ({ filePath, order: artifactPaths.indexOf(filePath) }))
    .sort((a, b) => a.order - b.order || a.filePath.localeCompare(b.filePath))
    .map(({ filePath }) => buildArtifact(repoRoot, sourceCommitSha, filePath));
  const manifestWithoutDigest = {
    run_id: runId,
    contract_version: contractVersion,
    source_commit_sha: sourceCommitSha,
    sprint_dir: normalizedSprintDir,
    artifacts,
    approved_at: approvedAt,
    reviewer_verdict: reviewerVerdict,
  };
  return {
    ...manifestWithoutDigest,
    manifest_digest: sha256(Buffer.from(stableStringify(manifestWithoutDigest))),
  };
}

export async function verifyApprovedContractManifest({
  repoRoot,
  manifest,
  currentCommitSha,
}) {
  if (!manifest) {
    return { ok: false, reason: 'approved_contract_manifest_missing' };
  }
  if (!currentCommitSha) {
    return { ok: false, reason: 'current_pr_sha_missing' };
  }
  const drift = [];
  const allowedMechanicalChanges = [];
  for (const artifact of manifest.artifacts ?? []) {
    const filePath = artifact.path;
    if (!gitPathExists(repoRoot, currentCommitSha, filePath)) {
      drift.push({ path: filePath, change: 'missing' });
      continue;
    }
    const current = buildArtifact(repoRoot, currentCommitSha, filePath, artifact.kind);
    if (
      current.git_blob_oid === artifact.git_blob_oid
      && current.sha256 === artifact.sha256
      && current.size === artifact.size
    ) {
      continue;
    }
    if (filePath === 'DoD.md') {
      const approvedContent = gitFileText(repoRoot, manifest.source_commit_sha, filePath);
      const currentContent = gitFileText(repoRoot, currentCommitSha, filePath);
      if (normalizeRootDod(approvedContent) === normalizeRootDod(currentContent)) {
        allowedMechanicalChanges.push({ path: filePath, change: 'mechanical' });
        continue;
      }
      drift.push({ path: filePath, change: 'semantic' });
      continue;
    }
    drift.push({ path: filePath, change: 'content' });
  }
  if (drift.length > 0) {
    return { ok: false, reason: 'approved_contract_drift', drift };
  }
  return {
    ok: true,
    manifest_digest: manifest.manifest_digest,
    allowed_mechanical_changes: allowedMechanicalChanges,
  };
}

export function verifyApprovedContractReference({
  manifestLoadError = null,
  manifest = null,
  expectedManifestDigest = null,
  currentPrSha = null,
}) {
  if (manifestLoadError) {
    return { ok: false, reason: 'approved_contract_manifest_unreachable' };
  }
  if (!manifest) {
    return { ok: false, reason: 'approved_contract_manifest_missing' };
  }
  if (!expectedManifestDigest) {
    return { ok: false, reason: 'approved_contract_manifest_digest_missing' };
  }
  if (!currentPrSha) {
    return { ok: false, reason: 'current_pr_sha_missing' };
  }
  if (manifest.manifest_digest !== expectedManifestDigest) {
    return { ok: false, reason: 'stale_manifest_digest' };
  }
  return { ok: true, manifest_digest: manifest.manifest_digest };
}

export function buildApprovedContractDispatchContext({
  role,
  contract,
  currentPrSha = null,
}) {
  const approvedManifest = asObject(contract?.approved_manifest);
  const manifestDigest = approvedDigestFromContract(contract);
  const sourceCommitSha = approvedSourceShaFromContract(contract);
  const inputs = {
    contract: {
      ...(contract ?? {}),
      approved_manifest: approvedManifest,
      manifest_digest: manifestDigest,
      source_commit_sha: sourceCommitSha,
    },
  };
  const env = {
    APPROVED_CONTRACT_MANIFEST_DIGEST: manifestDigest,
    APPROVED_CONTRACT_SOURCE_SHA: sourceCommitSha,
  };
  if (['evaluator', 'judge'].includes(role) && currentPrSha) {
    env.PR_HEAD_SHA = currentPrSha;
  }
  return { inputs, env };
}

export function verifyApprovedContractExecutionPreflight({
  role,
  contract,
  manifestLoadError = null,
  expectedManifestDigest = null,
  expectedPrHeadSha = null,
  currentPrSha = null,
}) {
  if (manifestLoadError) {
    return { ok: false, reason: 'approved_contract_manifest_unreachable' };
  }
  const approvedManifest = asObject(contract?.approved_manifest);
  const manifestDigest = approvedDigestFromContract(contract);
  if (!contract || !approvedManifest || !manifestDigest) {
    return { ok: false, reason: 'approved_contract_manifest_missing' };
  }
  if (!expectedManifestDigest) {
    return { ok: false, reason: 'approved_contract_manifest_digest_missing' };
  }
  if (manifestDigest !== expectedManifestDigest || approvedManifest.manifest_digest !== expectedManifestDigest) {
    return { ok: false, reason: 'stale_manifest_digest' };
  }
  if (['evaluator', 'judge'].includes(role)) {
    if (!currentPrSha) return { ok: false, reason: 'current_pr_sha_missing' };
    if (expectedPrHeadSha && currentPrSha !== expectedPrHeadSha) {
      return { ok: false, reason: 'stale_pr_head_sha' };
    }
  }
  return { ok: true, manifest_digest: manifestDigest };
}

export function verifyAttemptCallbackApprovedContract(attempt, result) {
  const role = attempt?.role;
  if (!['evaluator', 'generator'].includes(role)) return { ok: true };
  const inputs = attempt?.task_bundle?.inputs ?? {};
  const expectedDigest = approvedDigestFromContract(inputs.contract);
  const expectedPrHeadSha = inputs.pull_request?.head_sha ?? inputs.pr_head_sha ?? null;
  if (!expectedDigest && !expectedPrHeadSha) return { ok: true };

  const reportedDigest = callbackDigest(result);
  if (!reportedDigest) {
    return { ok: false, reason: 'approved_contract_manifest_digest_missing' };
  }
  if (reportedDigest !== expectedDigest) {
    return { ok: false, reason: `stale_${rolePrefix(role)}_manifest_digest` };
  }
  if (expectedPrHeadSha) {
    const reportedPrHeadSha = result?.provider_metadata?.pr_head_sha ?? null;
    if (!reportedPrHeadSha) {
      return { ok: false, reason: 'current_pr_sha_missing' };
    }
    if (reportedPrHeadSha !== expectedPrHeadSha) {
      return { ok: false, reason: `stale_${rolePrefix(role)}_pr_head_sha` };
    }
  }
  return { ok: true, manifest_digest: expectedDigest, pr_head_sha: expectedPrHeadSha };
}

export async function materializeApprovedContractManifest(db, {
  runId,
  version,
  branch,
  manifest,
  prdContent,
  contractContent,
}) {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`invalid approved contract version: ${version}`);
  }
  if (typeof branch !== 'string' || !branch) {
    throw new Error('approved contract branch is required');
  }
  if (!manifest || !SHA256_RE.test(String(manifest.manifest_digest ?? ''))) {
    throw new Error('approved contract manifest_digest is required');
  }
  const approvedAt = manifest.approved_at ?? new Date().toISOString();
  const { rows: runRows } = await db.query(
    `SELECT initiative_id
       FROM initiative_runs
      WHERE id = $1::uuid
      FOR UPDATE`,
    [runId],
  );
  if (!runRows[0]) {
    throw new Error(`cannot materialize approved contract manifest: run ${runId} not found`);
  }
  const initiativeId = runRows[0].initiative_id;

  const { rows: sameVersionRows } = await db.query(
    `SELECT id, manifest_digest, source_commit_sha, sprint_dir, approved_manifest, reviewer_verdict
       FROM initiative_contract_approvals
      WHERE initiative_id = $1::uuid
        AND contract_version = $2::integer
      ORDER BY approved_at, created_at, id`,
    [initiativeId, version],
  );
  if (sameVersionRows.length > 0) {
    const existing = sameVersionRows[0];
    if (existing.manifest_digest !== manifest.manifest_digest) {
      throw new Error('approved_contract_manifest_conflict: same contract_version has a different manifest_digest');
    }
    const { rows: contractRows } = await db.query(
      `SELECT id, initiative_id, version, status, branch, manifest_digest
         FROM initiative_contracts
        WHERE initiative_id = $1::uuid
          AND version = $2::integer
        LIMIT 1`,
      [initiativeId, version],
    );
    if (contractRows[0]) {
      await db.query(
        `UPDATE initiative_runs
            SET contract_id = $2::uuid, updated_at = $3::timestamptz
          WHERE id = $1::uuid`,
        [runId, contractRows[0].id, approvedAt],
      );
      return contractRows[0];
    }
  }

  const { rows: previousRows } = await db.query(
    `SELECT id
       FROM initiative_contract_approvals
      WHERE initiative_id = $1::uuid
      ORDER BY contract_version DESC, approved_at DESC, created_at DESC
      LIMIT 1`,
    [initiativeId],
  );
  const supersedesApprovalId = previousRows[0]?.id ?? null;

  const { rows: approvalRows } = await db.query(
    `INSERT INTO initiative_contract_approvals
       (initiative_id, run_id, contract_version, source_commit_sha, sprint_dir,
        manifest_digest, approved_manifest, reviewer_verdict, approved_at,
        supersedes_approval_id)
     VALUES
       ($1::uuid, $2::uuid, $3::integer, $4::text, $5::text,
        $6::text, $7::jsonb, $8::jsonb, $9::timestamptz, $10::uuid)
     RETURNING id`,
    [
      initiativeId,
      runId,
      version,
      manifest.source_commit_sha,
      manifest.sprint_dir,
      manifest.manifest_digest,
      JSON.stringify(manifest),
      JSON.stringify(manifest.reviewer_verdict ?? {}),
      approvedAt,
      supersedesApprovalId,
    ],
  );

  const { rows: contractRows } = await db.query(
    `INSERT INTO initiative_contracts
       (initiative_id, version, status, prd_content, contract_content,
        review_rounds, approved_at, branch, source_commit_sha, manifest_digest,
        approved_manifest, reviewer_verdict, created_at, updated_at)
     VALUES
       ($1::uuid, $2::integer, 'approved', $3::text, $4::text,
        $2::integer, $5::timestamptz, $6::text, $7::text, $8::text,
        $9::jsonb, $10::jsonb, $5::timestamptz, $5::timestamptz)
     ON CONFLICT (initiative_id, version) DO UPDATE
       SET status = 'approved',
           prd_content = EXCLUDED.prd_content,
           contract_content = EXCLUDED.contract_content,
           review_rounds = GREATEST(initiative_contracts.review_rounds, EXCLUDED.review_rounds),
           approved_at = EXCLUDED.approved_at,
           branch = EXCLUDED.branch,
           source_commit_sha = EXCLUDED.source_commit_sha,
           manifest_digest = EXCLUDED.manifest_digest,
           approved_manifest = EXCLUDED.approved_manifest,
           reviewer_verdict = EXCLUDED.reviewer_verdict,
           updated_at = EXCLUDED.updated_at
     RETURNING id, initiative_id, version, status, branch, manifest_digest`,
    [
      initiativeId,
      version,
      prdContent ?? null,
      contractContent ?? null,
      approvedAt,
      branch,
      manifest.source_commit_sha,
      manifest.manifest_digest,
      JSON.stringify(manifest),
      JSON.stringify(manifest.reviewer_verdict ?? {}),
    ],
  );
  const contractRow = contractRows[0];

  await db.query(
    `UPDATE initiative_contracts AS prior
        SET status = 'superseded', updated_at = $3::timestamptz
      WHERE prior.initiative_id = $1::uuid
        AND prior.id <> $2::uuid
        AND prior.status <> 'superseded'`,
    [initiativeId, contractRow.id, approvedAt],
  );
  await db.query(
    `UPDATE initiative_runs
        SET contract_id = $2::uuid, updated_at = $3::timestamptz
      WHERE id = $1::uuid`,
    [runId, contractRow.id, approvedAt],
  );
  return {
    ...contractRow,
    approval_id: approvalRows[0]?.id ?? null,
  };
}

export async function detectApprovedContractMainConflict({
  approvedSourceCommitSha,
  currentMainSha,
  approvedMigrationPath,
  currentMainMigrationPaths = [],
}) {
  if (!approvedSourceCommitSha || !currentMainSha || approvedSourceCommitSha === currentMainSha) {
    return { ok: true };
  }
  const number = migrationNumber(approvedMigrationPath);
  if (number == null) return { ok: true };
  const conflict = currentMainMigrationPaths
    .map(normalizeRepoPath)
    .find((filePath) => migrationNumber(filePath) === number && filePath !== normalizeRepoPath(approvedMigrationPath));
  if (!conflict) return { ok: true };
  return {
    ok: false,
    reason: 'requires_re_gan',
    conflict: 'migration_number',
    migration_number: number,
    conflicting_path: conflict,
  };
}

export const __test__ = {
  stableStringify,
  normalizeRootDod,
  extractReferencedPaths,
  migrationNumber,
};
