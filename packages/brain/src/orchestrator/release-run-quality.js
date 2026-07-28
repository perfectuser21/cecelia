import { ReleaseRunError } from './release-run-contract.js';

export const RELEASE_QUALITY_WORKFLOW = 'nightly-regression.yml';
export const RELEASE_QUALITY_BRANCH = 'main';
export const RELEASE_QUALITY_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const RECEIPT_KEYS = [
  'branch',
  'completed_at',
  'conclusion',
  'head_sha',
  'html_url',
  'repository',
  'run_id',
  'status',
  'workflow_file',
];

function deny(code) {
  throw new ReleaseRunError(code);
}

function canonicalTimestamp(value, code) {
  if (typeof value !== 'string') deny(code);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) deny(code);
  return parsed;
}

export function validateReleaseQualityObservation(
  observation,
  { repository, observedAt } = {},
) {
  if (!REPOSITORY_RE.test(repository ?? '')) {
    deny('release_quality_repository_invalid');
  }
  const observedTime = canonicalTimestamp(
    typeof observedAt === 'string' ? observedAt : observedAt?.toISOString?.(),
    'release_quality_observed_at_invalid',
  );
  if (
    observation == null
    || typeof observation !== 'object'
    || Array.isArray(observation)
    || Object.keys(observation).sort().join(',') !== RECEIPT_KEYS.join(',')
  ) {
    deny('release_quality_observation_invalid');
  }
  if (observation.status !== 'pass') deny('release_quality_status_invalid');
  if (observation.repository !== repository) deny('release_quality_repository_mismatch');
  if (observation.workflow_file !== RELEASE_QUALITY_WORKFLOW) {
    deny('release_quality_workflow_mismatch');
  }
  if (observation.branch !== RELEASE_QUALITY_BRANCH) {
    deny('release_quality_branch_mismatch');
  }
  if (!Number.isSafeInteger(observation.run_id) || observation.run_id < 1) {
    deny('release_quality_run_id_invalid');
  }
  if (!SHA_RE.test(observation.head_sha ?? '')) {
    deny('release_quality_head_sha_invalid');
  }
  if (observation.conclusion !== 'success') {
    deny('release_quality_conclusion_invalid');
  }
  const completedTime = canonicalTimestamp(
    observation.completed_at,
    'release_quality_completed_at_invalid',
  );
  const ageMs = observedTime.valueOf() - completedTime.valueOf();
  if (ageMs < 0) deny('release_quality_completed_at_future');
  if (ageMs > RELEASE_QUALITY_MAX_AGE_MS) deny('release_quality_stale');

  const expectedUrl =
    `https://github.com/${repository}/actions/runs/${observation.run_id}`;
  if (observation.html_url !== expectedUrl) deny('release_quality_url_mismatch');

  return Object.freeze({
    status: 'pass',
    repository,
    workflow_file: RELEASE_QUALITY_WORKFLOW,
    branch: RELEASE_QUALITY_BRANCH,
    run_id: observation.run_id,
    head_sha: observation.head_sha,
    conclusion: 'success',
    completed_at: completedTime.toISOString(),
    html_url: expectedUrl,
  });
}
