import { createHash } from 'node:crypto';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const PR_URL_PATTERN = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)$/;
const FILE_STATUS = new Set(['added', 'changed', 'copied', 'modified', 'removed', 'renamed', 'unchanged']);
const CI_FAILURE = new Set([
  'FAILURE',
  'ERROR',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
]);
const CI_SUCCESS = new Set(['SUCCESS']);

export const DEFAULT_REQUIRED_CHECK_POLICY_BY_REPOSITORY = Object.freeze({
  'perfectuser21/cecelia': Object.freeze([
    Object.freeze({
      context: 'ci-passed', app_slug: 'github-actions', app_id: 15368,
      branch_app_id: 15368, source: 'github-actions',
    }),
    Object.freeze({
      context: 'Harness V5 Gate Passed', app_slug: 'github-actions', app_id: 15368,
      branch_app_id: 15368, source: 'github-actions',
    }),
    Object.freeze({
      context: 'Smoke Glob Runner Passed', app_slug: 'github-actions', app_id: 15368,
      branch_app_id: null, source: 'github-actions',
    }),
  ]),
});

function sha256(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function parseIdentity(url) {
  const match = String(url ?? '').match(PR_URL_PATTERN);
  if (!match) throw new Error('github_pr_url_invalid');
  return { repository: match[1], number: Number(match[2]) };
}

function parseJson(value) {
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error('github_pr_observation_invalid');
  }
}

function validRepository(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

function normalizePullFiles(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error('github_pr_files_invalid');
  }
  const files = value.map((file) => {
    const previousPath = file.previous_filename ?? null;
    const patch = file.patch ?? null;
    if (
      typeof file.filename !== 'string'
      || file.filename.length === 0
      || file.filename.length > 1024
      || (previousPath != null && (typeof previousPath !== 'string' || previousPath.length === 0))
      || !FILE_STATUS.has(file.status)
      || !SHA_PATTERN.test(file.sha ?? '')
      || !Number.isInteger(file.additions)
      || file.additions < 0
      || !Number.isInteger(file.deletions)
      || file.deletions < 0
      || (patch != null && typeof patch !== 'string')
      || (file.status === 'renamed' && previousPath == null)
    ) {
      throw new Error('github_pr_files_invalid');
    }
    return {
      path: file.filename,
      previous_path: previousPath,
      status: file.status,
      blob_sha: file.sha,
      patch_digest: patch == null ? null : sha256(patch),
      additions: file.additions,
      deletions: file.deletions,
    };
  }).sort((left, right) => (
    left.path.localeCompare(right.path)
    || String(left.previous_path).localeCompare(String(right.previous_path))
  ));
  if (new Set(files.map(({ path }) => path)).size !== files.length) {
    throw new Error('github_pr_files_invalid');
  }
  return files;
}

export function canonicalPullRequestDiffDigest(files) {
  return sha256(JSON.stringify(normalizePullFiles(files)));
}

function requiredCheckRunIdentity(detailsUrl, repository) {
  try {
    const parsed = new URL(detailsUrl);
    const match = parsed.pathname.match(
      new RegExp(`^/${repository.replace('/', '\\/')}/actions/runs/([1-9][0-9]*)/job/([1-9][0-9]*)$`),
    );
    if (
      parsed.protocol !== 'https:'
      || parsed.hostname !== 'github.com'
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || !match
    ) return null;
    return { run_id: match[1], job_id: match[2] };
  } catch {
    return null;
  }
}

function normalizeRequiredCheckPolicy(policy) {
  if (!Array.isArray(policy) || policy.length === 0) return [];
  const normalized = policy.map((entry) => {
    if (
      !entry
      || typeof entry.context !== 'string'
      || entry.context.length === 0
      || entry.context.length > 256
      || !['github-actions', 'github-status'].includes(entry.source)
      || (entry.source === 'github-actions' && entry.app_slug !== 'github-actions')
      || (entry.source === 'github-status' && entry.app_slug != null)
    ) {
      throw new Error('github_required_check_policy_invalid');
    }
    return {
      context: entry.context,
      app_slug: entry.app_slug,
      app_id: entry.app_id ?? null,
      branch_app_id: Object.hasOwn(entry, 'branch_app_id')
        ? entry.branch_app_id
        : entry.app_id ?? null,
      source: entry.source,
    };
  });
  if (new Set(normalized.map(({ context }) => context)).size !== normalized.length) {
    throw new Error('github_required_check_policy_invalid');
  }
  return normalized;
}

function verifyRepositoryPolicy(protection, policy) {
  const configured = protection?.required_status_checks?.checks;
  const reviews = protection?.required_pull_request_reviews;
  const bypass = reviews?.bypass_pull_request_allowances;
  // GitHub's production API omits bypass_pull_request_allowances entirely
  // when no actor is allowed to bypass. A missing reviews policy remains
  // unknown and therefore fail-closed.
  const noBypass = reviews != null
    && (
      bypass == null
      || ['apps', 'teams', 'users'].every(
        (kind) => Array.isArray(bypass[kind]) && bypass[kind].length === 0,
      )
    );
  const exactChecks = Array.isArray(configured)
    && configured.length === policy.length
    && policy.every((required) => configured.some(
      (check) => check?.context === required.context
        && (required.branch_app_id == null
          ? check?.app_id == null
          : Number(check?.app_id) === required.branch_app_id),
    ));
  const atomic = protection?.required_status_checks?.strict === true
    && protection?.enforce_admins?.enabled === true
    && protection?.allow_force_pushes?.enabled !== true
    && protection?.allow_deletions?.enabled !== true
    && noBypass
    && exactChecks;
  return Object.freeze({
    atomic_merge_backstop: atomic,
    required_checks_strict: protection?.required_status_checks?.strict === true,
    administrators_enforced: protection?.enforce_admins?.enabled === true,
    bypass_disabled: noBypass,
    required_contexts: policy.map(({ context }) => context),
  });
}

function assessRequiredChecks(checkRuns, {
  policy,
  repository,
  headSha,
  mergeStateStatus,
}) {
  if (!Array.isArray(checkRuns) || policy.length === 0) {
    return { ci: 'pending', required_checks: [] };
  }
  const evidence = [];
  let failed = false;
  for (const required of policy) {
    const named = checkRuns.filter((check) => check?.name === required.context);
    const trusted = named.filter((check) => {
      const identity = requiredCheckRunIdentity(check?.details_url, repository);
      return check?.app?.slug === required.app_slug
        && (required.app_id == null || Number(check?.app?.id) === required.app_id)
        && check?.head_sha === headSha
        && check?.status === 'completed'
        && identity != null;
    });
    if (trusted.length !== 1) continue;
    const check = trusted[0];
    const identity = requiredCheckRunIdentity(check.details_url, repository);
    const conclusion = String(check.conclusion ?? '').toUpperCase();
    if (CI_FAILURE.has(conclusion)) failed = true;
    evidence.push({
      context: required.context,
      app_slug: required.app_slug,
      source: required.source,
      ...identity,
      head_sha: headSha,
      conclusion,
    });
  }
  if (failed) return { ci: 'fail', required_checks: evidence };
  const allRequiredPassed = evidence.length === policy.length
    && evidence.every(({ conclusion }) => CI_SUCCESS.has(conclusion));
  return {
    ci: allRequiredPassed && mergeStateStatus === 'CLEAN' ? 'pass' : 'pending',
    required_checks: evidence,
  };
}

function headRepositoryName(observed, baseRepository) {
  if (observed?.isCrossRepository === false) return baseRepository;
  if (observed?.isCrossRepository !== true) return null;
  const owner = observed?.headRepositoryOwner?.login;
  const name = observed?.headRepository?.name;
  const repository = `${owner ?? ''}/${name ?? ''}`;
  return validRepository(repository) ? repository : null;
}

function changedPaths(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 3000) {
    throw new Error('github_pr_files_invalid');
  }
  const paths = files.map((file) => file?.path);
  if (paths.some((path) => (
    typeof path !== 'string'
    || path.length < 1
    || path.length > 1024
    || path.startsWith('/')
    || path.includes('\\')
    || path.includes('\0')
    || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ))) {
    throw new Error('github_pr_files_invalid');
  }
  return [...new Set(paths)].sort();
}

export function createGitHubMergeAdapter({
  execFile,
  requiredCheckPolicy,
}) {
  if (typeof execFile !== 'function') throw new Error('github_exec_file_required');

  return Object.freeze({
    async observePullRequest(prUrl) {
      const identity = parseIdentity(prUrl);
      const output = await execFile('gh', [
        'pr',
        'view',
        prUrl,
        '--json',
        'url,number,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository,baseRefName,baseRefOid,state,isDraft,mergeStateStatus,changedFiles,mergeCommit',
      ]);
      const observed = parseJson(output);
      if (observed.url !== prUrl || Number(observed.number) !== identity.number) {
        throw new Error('github_pr_identity_mismatch');
      }
      if (!SHA_PATTERN.test(observed.headRefOid ?? '')) {
        throw new Error('github_pr_head_invalid');
      }
      // A PR URL is rooted in its base repository. gh's supported JSON fields
      // do not include baseRepository, and same-repository headRepository may
      // return an empty nameWithOwner. Bind the base to the parsed URL and use
      // explicit cross-repository metadata only when GitHub says it is a fork.
      const baseRepository = identity.repository;
      const headRepository = headRepositoryName(observed, baseRepository);
      if (
        !validRepository(headRepository)
        || !validRepository(baseRepository)
        || typeof observed.baseRefName !== 'string'
        || observed.baseRefName.length === 0
        || !SHA_PATTERN.test(observed.baseRefOid ?? '')
      ) {
        throw new Error('github_pr_base_invalid');
      }

      const rawFiles = parseJson(await execFile('gh', [
        'api',
        `repos/${identity.repository}/pulls/${identity.number}/files?per_page=100`,
      ]));
      if (
        !Number.isInteger(observed.changedFiles)
        || observed.changedFiles < 1
        || !Array.isArray(rawFiles)
        || rawFiles.length !== observed.changedFiles
      ) {
        throw new Error('github_pr_files_incomplete');
      }
      const files = normalizePullFiles(rawFiles);
      const checkPayload = parseJson(await execFile('gh', [
        'api',
        `repos/${identity.repository}/commits/${observed.headRefOid}/check-runs?per_page=100`,
        '-H',
        'Accept: application/vnd.github+json',
      ]));
      if (
        !Number.isInteger(checkPayload?.total_count)
        || checkPayload.total_count !== checkPayload?.check_runs?.length
        || checkPayload.total_count > 100
      ) {
        throw new Error('github_check_runs_incomplete');
      }
      const policy = normalizeRequiredCheckPolicy(
        requiredCheckPolicy
          ?? DEFAULT_REQUIRED_CHECK_POLICY_BY_REPOSITORY[identity.repository]
          ?? [],
      );
      const protection = parseJson(await execFile('gh', [
        'api',
        `repos/${identity.repository}/branches/${encodeURIComponent(observed.baseRefName)}/protection`,
        '-H',
        'Accept: application/vnd.github+json',
      ]));
      const repositoryPolicy = verifyRepositoryPolicy(protection, policy);
      const checkAuthority = assessRequiredChecks(checkPayload?.check_runs, {
        policy,
        repository: identity.repository,
        headSha: observed.headRefOid,
        mergeStateStatus: observed.mergeStateStatus,
      });
      if (!repositoryPolicy.atomic_merge_backstop && checkAuthority.ci === 'pass') {
        checkAuthority.ci = 'pending';
      }
      return {
        url: prUrl,
        repository: identity.repository,
        number: identity.number,
        head_repository: headRepository,
        head_ref: observed.headRefName,
        head_sha: observed.headRefOid,
        base_repository: baseRepository,
        base_ref: observed.baseRefName,
        base_sha: observed.baseRefOid,
        state: observed.state,
        is_draft: observed.isDraft === true,
        merge_state_status: observed.mergeStateStatus,
        ...checkAuthority,
        merged: observed.state === 'MERGED',
        merge_commit_sha: observed.mergeCommit?.oid ?? null,
        diff_digest: sha256(JSON.stringify(files)),
        files,
        repository_policy: repositoryPolicy,
        changed_paths: changedPaths(files),
      };
    },

    async mergePullRequest({ pr_url: prUrl, expected_head_sha: expectedHeadSha, method }) {
      parseIdentity(prUrl);
      if (!SHA_PATTERN.test(expectedHeadSha ?? '')) throw new Error('github_pr_head_invalid');
      if (method !== 'squash') throw new Error('github_merge_method_invalid');
      await execFile('gh', [
        'pr',
        'merge',
        prUrl,
        '--squash',
        '--delete-branch',
        '--match-head-commit',
        expectedHeadSha,
      ]);
    },
  });
}

export const __test__ = {
  assessRequiredChecks,
  changedPaths,
  normalizePullFiles,
  normalizeRequiredCheckPolicy,
  parseIdentity,
  requiredCheckRunIdentity,
  verifyRepositoryPolicy,
};
