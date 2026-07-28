'use strict';

const crypto = require('node:crypto');

const MAX_CANONICAL_BYTES = 1024 * 1024;
const MAX_SUMMARY_BYTES = 8192;
const ROLE_VALUES = new Set([
  'planner',
  'proposer',
  'reviewer',
  'generator',
  'evaluator',
  'reporter',
]);
const PROVIDER_STATUSES = new Set(['completed', 'completed_with_concerns']);
const RUBRIC_KEYS = [
  'dod_machineability',
  'scope_match_prd',
  'test_is_red',
  'internal_consistency',
  'risk_registered',
  'verification_oracle_completeness',
  'ci_workflow_alignment',
];
const PROVIDER_METADATA_KEYS = [
  'provider',
  'session_id',
  'credential_ref',
  'credential_copy_mutated',
  'machine_id',
  'machine_attestation',
  'pr_head_sha',
];

function invalid(message) {
  throw new Error(`result_channel_finalizer: ${message}`);
}

function assertObject(value, path) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    invalid(`${path} must be a plain object`);
  }
}

function exactObject(value, required, optional, path) {
  assertObject(value, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`${path} unknown field: ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) invalid(`${path} missing field: ${key}`);
  }
  return value;
}

function string(value, path, { min = 1, max = 4096, pattern = null } = {}) {
  if (typeof value !== 'string') invalid(`${path} must be a string`);
  const size = Buffer.byteLength(value);
  if (size < min || size > max) invalid(`${path} length is outside bounds`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    invalid(`${path} contains control characters`);
  }
  if (pattern && !pattern.test(value)) invalid(`${path} is invalid`);
  return value;
}

function nullableString(value, path, options) {
  if (value === null) return null;
  return string(value, path, options);
}

function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    invalid(`${path} must be an integer in range`);
  }
  return value;
}

function enumeration(value, values, path) {
  if (!values.includes(value)) invalid(`${path} is invalid`);
  return value;
}

function uuid(value, path) {
  return string(value, path, {
    max: 36,
    pattern: /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
  });
}

function gitSha(value, path) {
  return string(value, path, { max: 40, pattern: /^[a-f0-9]{40}$/ });
}

function sha256(value, path) {
  return string(value, path, { max: 71, pattern: /^sha256:[a-f0-9]{64}$/ });
}

function branch(value, path) {
  return string(value, path, {
    max: 255,
    pattern: /^(?![./])(?!.*(?:\.\.|\/\/|@\{|[~^:?*\\\s]))(?!.*[./]$)[A-Za-z0-9._/-]+$/,
  });
}

function relativePath(value, path) {
  const parsed = string(value, path, { max: 1024 });
  if (
    parsed.startsWith('/')
    || parsed.split('/').some((part) => part === '' || part === '.' || part === '..')
    || /[\r\n\\]/.test(parsed)
  ) {
    invalid(`${path} must be a normalized relative path`);
  }
  return parsed;
}

function webUrl(value, path) {
  const parsed = string(value, path, { max: 2048 });
  let url;
  try {
    url = new URL(parsed);
  } catch {
    invalid(`${path} must be a URL`);
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    invalid(`${path} must be an http(s) URL without credentials`);
  }
  return parsed;
}

function evidenceLocation(value, path) {
  const parsed = string(value, path, { max: 4096 });
  if (/^https?:\/\//.test(parsed)) return webUrl(parsed, path);
  return relativePath(parsed, path);
}

function canonicalize(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('canonical JSON rejects non-finite numbers');
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) invalid('canonical JSON rejects cycles');
    seen.add(value);
    const result = value.map((item) => {
      if (item === undefined) invalid('canonical JSON rejects undefined array items');
      return canonicalize(item, seen);
    });
    seen.delete(value);
    return result;
  }
  assertObject(value, 'canonical JSON value');
  if (seen.has(value)) invalid('canonical JSON rejects cycles');
  seen.add(value);
  // A normal object treats an own "__proto__" assignment as a prototype
  // mutation. Preserve every JSON key in the canonical byte stream.
  const result = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) invalid(`canonical JSON rejects undefined field: ${key}`);
    result[key] = canonicalize(value[key], seen);
  }
  seen.delete(value);
  return result;
}

function canonicalJson(value) {
  const encoded = JSON.stringify(canonicalize(value, new Set()));
  if (Buffer.byteLength(encoded) > MAX_CANONICAL_BYTES) {
    invalid('canonical JSON exceeds byte limit');
  }
  return encoded;
}

function cloneCanonical(value) {
  return JSON.parse(canonicalJson(value));
}

function sameValue(actual, expected, path) {
  if (canonicalJson(actual) !== canonicalJson(expected)) invalid(`${path} mismatch`);
}

function validateBinding(value) {
  exactObject(value, ['task_id', 'run_id', 'attempt_id', 'role'], [], 'binding');
  string(value.task_id, 'binding.task_id', { max: 128, pattern: /^[^\r\n]+$/ });
  uuid(value.run_id, 'binding.run_id');
  uuid(value.attempt_id, 'binding.attempt_id');
  if (!ROLE_VALUES.has(value.role)) invalid('binding.role is invalid');
  return value;
}

function validateProviderMetadata(value) {
  exactObject(value, ['provider'], PROVIDER_METADATA_KEYS.slice(1), 'providerResult.provider_metadata');
  string(value.provider, 'providerResult.provider_metadata.provider', { max: 64 });
  if (Object.hasOwn(value, 'session_id') && value.session_id !== null) {
    string(value.session_id, 'providerResult.provider_metadata.session_id', { max: 512 });
  }
  if (Object.hasOwn(value, 'credential_ref')) uuid(
    value.credential_ref,
    'providerResult.provider_metadata.credential_ref',
  );
  if (
    Object.hasOwn(value, 'credential_copy_mutated')
    && typeof value.credential_copy_mutated !== 'boolean'
  ) {
    invalid('providerResult.provider_metadata.credential_copy_mutated must be boolean');
  }
  for (const key of ['machine_id', 'machine_attestation', 'pr_head_sha']) {
    if (Object.hasOwn(value, key)) {
      string(value[key], `providerResult.provider_metadata.${key}`, { max: 2048 });
    }
  }
}

function validateProviderResult(value, binding) {
  exactObject(value, [
    'contract_version',
    'attempt_id',
    'status',
    'summary',
    'artifacts',
    'checks',
    'decision',
    'error',
    'provider_metadata',
  ], [], 'providerResult');
  if (value.contract_version !== '1.0') invalid('providerResult.contract_version is invalid');
  uuid(value.attempt_id, 'providerResult.attempt_id');
  if (value.attempt_id !== binding.attempt_id) invalid('providerResult attempt_id mismatch');
  if (!PROVIDER_STATUSES.has(value.status)) {
    invalid('providerResult.status cannot finalize a role result');
  }
  string(value.summary, 'providerResult.summary', { min: 0, max: MAX_SUMMARY_BYTES });
  if (!Array.isArray(value.artifacts) || value.artifacts.length !== 0) {
    invalid('providerResult.artifacts must be empty; verifierEnvelope owns observed artifacts');
  }
  if (!Array.isArray(value.checks) || value.checks.length !== 0) {
    invalid('providerResult.checks must be empty; verifierEnvelope owns observed checks');
  }
  if (value.decision !== null) {
    invalid('providerResult.decision must be null; role_result owns the business decision');
  }
  if (value.error !== null) invalid('providerResult.error must be null for a finalized role result');
  validateProviderMetadata(value.provider_metadata);
  return value;
}

function validateRubric(value, path) {
  exactObject(value, RUBRIC_KEYS, [], path);
  for (const key of RUBRIC_KEYS) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])
        || value[key] < 0 || value[key] > 10) {
      invalid(`${path}.${key} must be a finite score from 0 to 10`);
    }
  }
  return value;
}

function validateArtifactDigest(value, path) {
  exactObject(value, ['path', 'sha256'], [], path);
  relativePath(value.path, `${path}.path`);
  sha256(value.sha256, `${path}.sha256`);
  return value;
}

function validatePullRequest(value, path, allowedStates = ['OPEN']) {
  exactObject(
    value,
    ['type', 'url', 'number', 'head_ref', 'head_sha', 'state'],
    [],
    path,
  );
  if (value.type !== 'pull_request') invalid(`${path}.type is invalid`);
  webUrl(value.url, `${path}.url`);
  integer(value.number, `${path}.number`, { min: 1 });
  branch(value.head_ref, `${path}.head_ref`);
  gitSha(value.head_sha, `${path}.head_sha`);
  if (!allowedStates.includes(value.state)) {
    invalid(`${path}.state must be ${allowedStates.join(' or ')}`);
  }
  return value;
}

function validateBehaviorTest(value, path) {
  exactObject(
    value,
    ['command', 'exit_code', 'log_tail'],
    ['verification_level', 'action', 'expected'],
    path,
  );
  string(value.command, `${path}.command`, { max: 16384 });
  integer(value.exit_code, `${path}.exit_code`, { min: 0, max: 255 });
  string(value.log_tail, `${path}.log_tail`, { min: 0, max: 32768 });
  if (Object.hasOwn(value, 'verification_level')) {
    enumeration(value.verification_level, ['L1', 'L2', 'L3'], `${path}.verification_level`);
  }
  for (const key of ['action', 'expected']) {
    if (Object.hasOwn(value, key)) string(value[key], `${path}.${key}`, { max: 8192 });
  }
  return value;
}

function validateBehaviorTests(value, path) {
  if (!Array.isArray(value) || value.length > 256) invalid(`${path} must be a bounded array`);
  value.forEach((item, index) => validateBehaviorTest(item, `${path}[${index}]`));
  return value;
}

function validateCascadeAssertion(value, path) {
  exactObject(value, ['link_id', 'assertion_ref', 'ran', 'result'], [], path);
  string(value.link_id, `${path}.link_id`, { max: 128 });
  string(value.assertion_ref, `${path}.assertion_ref`, { min: 0, max: 8192 });
  if (typeof value.ran !== 'boolean') invalid(`${path}.ran must be boolean`);
  enumeration(value.result, ['pass', 'fail', 'skip'], `${path}.result`);
  if (value.ran !== (value.result !== 'skip')) invalid(`${path} ran/result mismatch`);
  return value;
}

function validatePlanner(raw, verified) {
  exactObject(
    raw,
    ['verdict', 'branch', 'sprint_dir', 'planner_branch', 'review_required', 'status'],
    [],
    'rawEnvelope',
  );
  enumeration(raw.verdict, ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'], 'rawEnvelope.verdict');
  enumeration(raw.status, ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'], 'rawEnvelope.status');
  if (raw.status !== raw.verdict) invalid('rawEnvelope status/verdict mismatch');
  branch(raw.branch, 'rawEnvelope.branch');
  relativePath(raw.sprint_dir, 'rawEnvelope.sprint_dir');
  branch(raw.planner_branch, 'rawEnvelope.planner_branch');
  if (typeof raw.review_required !== 'boolean') invalid('rawEnvelope.review_required must be boolean');

  exactObject(
    verified,
    [
      'branch',
      'sprint_dir',
      'planner_branch',
      'prd_sha256',
      'effective_review_required',
    ],
    [],
    'verifierEnvelope',
  );
  branch(verified.branch, 'verifierEnvelope.branch');
  relativePath(verified.sprint_dir, 'verifierEnvelope.sprint_dir');
  branch(verified.planner_branch, 'verifierEnvelope.planner_branch');
  sha256(verified.prd_sha256, 'verifierEnvelope.prd_sha256');
  if (typeof verified.effective_review_required !== 'boolean') {
    invalid('verifierEnvelope.effective_review_required must be boolean');
  }
  for (const key of ['branch', 'sprint_dir', 'planner_branch']) {
    if (raw[key] !== verified[key]) invalid(`${key} mismatch`);
  }
  if (raw.review_required && !verified.effective_review_required) {
    invalid('review_required downgrade');
  }
  return {
    status: {
      DONE: 'completed',
      DONE_WITH_CONCERNS: 'completed_with_concerns',
      NEEDS_CONTEXT: 'needs_context',
      BLOCKED: 'blocked',
    }[raw.status],
    artifacts: [{
      type: 'planner_prd',
      path: verified.sprint_dir,
      sha256: verified.prd_sha256,
      branch: verified.branch,
    }],
    checks: [],
    decision: {
      outcome: raw.verdict,
      reason: '',
      review_required: verified.effective_review_required,
    },
  };
}

function validateProposer(raw, verified) {
  exactObject(
    raw,
    ['propose_branch', 'workstream_count', 'task_plan_path'],
    [],
    'rawEnvelope',
  );
  branch(raw.propose_branch, 'rawEnvelope.propose_branch');
  if (raw.workstream_count !== 1) invalid('rawEnvelope.workstream_count must equal 1');
  relativePath(raw.task_plan_path, 'rawEnvelope.task_plan_path');
  exactObject(
    verified,
    ['propose_branch', 'head_sha', 'artifacts'],
    [],
    'verifierEnvelope',
  );
  branch(verified.propose_branch, 'verifierEnvelope.propose_branch');
  gitSha(verified.head_sha, 'verifierEnvelope.head_sha');
  if (raw.propose_branch !== verified.propose_branch) invalid('propose_branch mismatch');
  exactObject(
    verified.artifacts,
    ['contract_draft', 'contract_dod', 'task_plan', 'contract_tests'],
    [],
    'verifierEnvelope.artifacts',
  );
  for (const key of ['contract_draft', 'contract_dod', 'task_plan', 'contract_tests']) {
    validateArtifactDigest(verified.artifacts[key], `verifierEnvelope.artifacts.${key}`);
  }
  if (verified.artifacts.task_plan.path !== raw.task_plan_path) invalid('task_plan_path mismatch');
  const expectedSuffixes = {
    contract_draft: '/contract-draft.md',
    contract_dod: '/contract-dod.md',
    task_plan: '/task-plan.json',
    contract_tests: '/tests',
  };
  for (const [key, suffix] of Object.entries(expectedSuffixes)) {
    if (!verified.artifacts[key].path.endsWith(suffix)) {
      invalid(`verifierEnvelope.artifacts.${key}.path is invalid`);
    }
  }
  return {
    status: 'completed',
    artifacts: Object.entries(verified.artifacts).map(([kind, artifact]) => ({
      type: kind,
      ...artifact,
      branch: verified.propose_branch,
      head_sha: verified.head_sha,
    })),
    checks: [],
    decision: null,
  };
}

function validateReviewer(raw, verified) {
  exactObject(
    raw,
    ['verdict', 'rubric_scores', 'judgments_written', 'feedback'],
    [],
    'rawEnvelope',
  );
  enumeration(raw.verdict, ['APPROVED', 'REVISION'], 'rawEnvelope.verdict');
  validateRubric(raw.rubric_scores, 'rawEnvelope.rubric_scores');
  integer(raw.judgments_written, 'rawEnvelope.judgments_written', { max: 10000 });
  string(raw.feedback, 'rawEnvelope.feedback', { min: 0, max: 32768 });
  if (raw.verdict === 'REVISION' && raw.judgments_written !== 0) {
    invalid('REVISION judgments_written must equal 0');
  }
  exactObject(
    verified,
    ['contract_sha', 'verdict', 'rubric_scores', 'judgments_written'],
    [],
    'verifierEnvelope',
  );
  gitSha(verified.contract_sha, 'verifierEnvelope.contract_sha');
  enumeration(verified.verdict, ['APPROVED', 'REVISION'], 'verifierEnvelope.verdict');
  validateRubric(verified.rubric_scores, 'verifierEnvelope.rubric_scores');
  integer(verified.judgments_written, 'verifierEnvelope.judgments_written', { max: 10000 });
  if (verified.verdict !== raw.verdict) invalid('verdict mismatch');
  sameValue(verified.rubric_scores, raw.rubric_scores, 'rubric_scores');
  if (verified.judgments_written !== raw.judgments_written) invalid('judgments_written mismatch');
  return {
    status: 'completed',
    artifacts: [],
    checks: RUBRIC_KEYS.map((name) => ({ name, score: verified.rubric_scores[name] })),
    decision: {
      outcome: verified.verdict,
      reason: raw.feedback,
      contract_sha: verified.contract_sha,
      judgments_written: verified.judgments_written,
    },
  };
}

function validateGenerator(raw, verified) {
  assertObject(raw, 'rawEnvelope');
  enumeration(raw.verdict, ['DONE', 'FIXED', 'FAILED'], 'rawEnvelope.verdict');
  const requiredByVerdict = {
    DONE: ['verdict', 'pr_url'],
    FIXED: ['verdict', 'pr_url', 'fixes'],
    FAILED: ['verdict', 'pr_url', 'reason'],
  };
  exactObject(raw, requiredByVerdict[raw.verdict], [], 'rawEnvelope');
  webUrl(raw.pr_url, 'rawEnvelope.pr_url');
  if (raw.verdict === 'FIXED') {
    if (!Array.isArray(raw.fixes) || raw.fixes.length === 0 || raw.fixes.length > 100) {
      invalid('rawEnvelope.fixes must be a bounded non-empty array');
    }
    raw.fixes.forEach((fix, index) => string(fix, `rawEnvelope.fixes[${index}]`, { max: 4096 }));
  }
  if (raw.verdict === 'FAILED') string(raw.reason, 'rawEnvelope.reason', { max: 32768 });

  exactObject(verified, ['pull_request'], [], 'verifierEnvelope');
  validatePullRequest(verified.pull_request, 'verifierEnvelope.pull_request');
  if (verified.pull_request.url !== raw.pr_url) invalid('pr_url mismatch');
  return {
    status: raw.verdict === 'FAILED' ? 'completed_with_concerns' : 'completed',
    artifacts: [cloneCanonical(verified.pull_request)],
    checks: [],
    decision: {
      outcome: raw.verdict,
      reason: raw.reason ?? (raw.fixes ? raw.fixes.join('; ') : ''),
      pr_head_sha: verified.pull_request.head_sha,
    },
  };
}

function validateEvaluator(raw, verified, binding) {
  exactObject(
    raw,
    ['verdict', 'task_id', 'attempt_id'],
    [
      'failed_step',
      'log_excerpt',
      'behavior_tests',
      'unverifiable',
      'verification_level',
      'screenshots',
      'cascade_assertions',
      'notes',
      'feedback',
      'segment_eval',
    ],
    'rawEnvelope',
  );
  enumeration(raw.verdict, ['PASS', 'FAIL'], 'rawEnvelope.verdict');
  string(raw.task_id, 'rawEnvelope.task_id', { max: 128 });
  uuid(raw.attempt_id, 'rawEnvelope.attempt_id');
  if (raw.task_id !== binding.task_id) invalid('task_id mismatch');
  if (raw.attempt_id !== binding.attempt_id) invalid('attempt_id mismatch');
  if (Object.hasOwn(raw, 'failed_step')) {
    nullableString(raw.failed_step, 'rawEnvelope.failed_step', { max: 8192 });
  }
  if (Object.hasOwn(raw, 'log_excerpt')) {
    nullableString(raw.log_excerpt, 'rawEnvelope.log_excerpt', { max: 32768 });
  }
  if (Object.hasOwn(raw, 'verification_level')) {
    enumeration(raw.verification_level, ['L1', 'L2', 'L3'], 'rawEnvelope.verification_level');
  }
  if (Object.hasOwn(raw, 'notes')) string(raw.notes, 'rawEnvelope.notes', { max: 32768 });
  if (Object.hasOwn(raw, 'feedback')) {
    string(raw.feedback, 'rawEnvelope.feedback', { max: 32768 });
  }
  if (Object.hasOwn(raw, 'segment_eval')) {
    string(raw.segment_eval, 'rawEnvelope.segment_eval', { max: 128 });
  }
  if (Object.hasOwn(raw, 'screenshots')) {
    if (!Array.isArray(raw.screenshots) || raw.screenshots.length > 256) {
      invalid('rawEnvelope.screenshots must be bounded');
    }
    raw.screenshots.forEach(
      (item, index) => evidenceLocation(item, `rawEnvelope.screenshots[${index}]`),
    );
  }
  if (Object.hasOwn(raw, 'cascade_assertions')) {
    if (!Array.isArray(raw.cascade_assertions) || raw.cascade_assertions.length > 256) {
      invalid('rawEnvelope.cascade_assertions must be bounded');
    }
    raw.cascade_assertions.forEach(
      (item, index) => validateCascadeAssertion(
        item,
        `rawEnvelope.cascade_assertions[${index}]`,
      ),
    );
  }
  const claimedTests = Object.hasOwn(raw, 'behavior_tests') ? raw.behavior_tests : [];
  validateBehaviorTests(claimedTests, 'rawEnvelope.behavior_tests');
  const unverifiable = Object.hasOwn(raw, 'unverifiable') ? raw.unverifiable : [];
  if (!Array.isArray(unverifiable) || unverifiable.length > 256) {
    invalid('rawEnvelope.unverifiable must be a bounded array');
  }
  unverifiable.forEach((item, index) => {
    exactObject(item, ['item', 'reason'], [], `rawEnvelope.unverifiable[${index}]`);
    string(item.item, `rawEnvelope.unverifiable[${index}].item`, { max: 8192 });
    string(item.reason, `rawEnvelope.unverifiable[${index}].reason`, { max: 8192 });
  });

  exactObject(
    verified,
    ['contract_sha', 'pull_request', 'behavior_tests'],
    [],
    'verifierEnvelope',
  );
  gitSha(verified.contract_sha, 'verifierEnvelope.contract_sha');
  validatePullRequest(verified.pull_request, 'verifierEnvelope.pull_request');
  validateBehaviorTests(verified.behavior_tests, 'verifierEnvelope.behavior_tests');
  sameValue(verified.behavior_tests, claimedTests, 'behavior_tests');
  if (raw.verdict === 'PASS') {
    if (claimedTests.length === 0) invalid('PASS requires behavior_tests');
    if (claimedTests.some((check) => check.exit_code !== 0)) {
      invalid('PASS requires zero exit_code for every behavior test');
    }
  }
  return {
    status: unverifiable.length > 0 ? 'completed_with_concerns' : 'completed',
    artifacts: [{
      type: 'evaluation_target',
      url: verified.pull_request.url,
      number: verified.pull_request.number,
      head_ref: verified.pull_request.head_ref,
      head_sha: verified.pull_request.head_sha,
      contract_sha: verified.contract_sha,
    }],
    checks: cloneCanonical(verified.behavior_tests),
    decision: {
      outcome: raw.verdict,
      reason: raw.feedback ?? raw.log_excerpt ?? raw.failed_step ?? '',
      pr_head_sha: verified.pull_request.head_sha,
      contract_sha: verified.contract_sha,
      unverifiable: cloneCanonical(unverifiable),
    },
  };
}

function validateReporter(raw, verified, binding) {
  exactObject(
    raw,
    ['verdict', 'task_id', 'report_path', 'pr_url', 'screenshots', 'concerns'],
    [],
    'rawEnvelope',
  );
  enumeration(raw.verdict, ['DONE', 'DONE_WITH_CONCERNS'], 'rawEnvelope.verdict');
  string(raw.task_id, 'rawEnvelope.task_id', { max: 128 });
  if (raw.task_id !== binding.task_id) invalid('task_id mismatch');
  relativePath(raw.report_path, 'rawEnvelope.report_path');
  webUrl(raw.pr_url, 'rawEnvelope.pr_url');
  if (!Array.isArray(raw.screenshots) || raw.screenshots.length > 256) {
    invalid('rawEnvelope.screenshots must be a bounded array');
  }
  raw.screenshots.forEach((item, index) => relativePath(item, `rawEnvelope.screenshots[${index}]`));
  string(raw.concerns, 'rawEnvelope.concerns', { min: 0, max: 32768 });

  exactObject(
    verified,
    ['pull_request', 'report', 'learning', 'screenshots', 'learnings_inserted'],
    [],
    'verifierEnvelope',
  );
  validatePullRequest(
    verified.pull_request,
    'verifierEnvelope.pull_request',
    ['OPEN', 'MERGED'],
  );
  validateArtifactDigest(verified.report, 'verifierEnvelope.report');
  validateArtifactDigest(verified.learning, 'verifierEnvelope.learning');
  if (!Array.isArray(verified.screenshots) || verified.screenshots.length > 256) {
    invalid('verifierEnvelope.screenshots must be a bounded array');
  }
  verified.screenshots.forEach(
    (item, index) => validateArtifactDigest(item, `verifierEnvelope.screenshots[${index}]`),
  );
  integer(verified.learnings_inserted, 'verifierEnvelope.learnings_inserted', { max: 100000 });
  if (verified.pull_request.url !== raw.pr_url) invalid('pr_url mismatch');
  if (verified.report.path !== raw.report_path) invalid('report_path mismatch');
  sameValue(
    verified.screenshots.map((item) => item.path),
    raw.screenshots,
    'screenshots',
  );
  return {
    status: raw.verdict === 'DONE_WITH_CONCERNS'
      ? 'completed_with_concerns'
      : 'completed',
    artifacts: [
      cloneCanonical(verified.pull_request),
      { type: 'harness_report', ...cloneCanonical(verified.report) },
      { type: 'learning', ...cloneCanonical(verified.learning) },
      ...verified.screenshots.map((item) => ({
        type: 'screenshot',
        ...cloneCanonical(item),
      })),
    ],
    checks: [{
      type: 'learnings_inserted',
      count: verified.learnings_inserted,
    }],
    decision: {
      outcome: raw.verdict,
      reason: raw.concerns,
    },
  };
}

const ROLE_VALIDATORS = {
  planner: validatePlanner,
  proposer: validateProposer,
  reviewer: validateReviewer,
  generator: validateGenerator,
  evaluator: validateEvaluator,
  reporter: validateReporter,
};

function finalizeRoleResult(value) {
  exactObject(
    value,
    ['expectedOutput', 'binding', 'providerResult', 'rawEnvelope', 'verifierEnvelope'],
    [],
    'input',
  );
  const binding = validateBinding(value.binding);
  const expected = `harness-result/${binding.role}-v1`;
  if (value.expectedOutput !== expected) invalid('expectedOutput/role mismatch');
  const providerResult = validateProviderResult(value.providerResult, binding);
  const raw = cloneCanonical(value.rawEnvelope);
  const verified = cloneCanonical(value.verifierEnvelope);
  const normalized = ROLE_VALIDATORS[binding.role](raw, verified, binding);
  if (
    providerResult.status === 'completed_with_concerns'
    && normalized.status === 'completed'
  ) {
    normalized.status = 'completed_with_concerns';
  }
  const rawSha256 = crypto.createHash('sha256').update(canonicalJson(raw)).digest('hex');
  const result = {
    contract_version: '1.0',
    attempt_id: binding.attempt_id,
    status: normalized.status,
    summary: providerResult.summary,
    artifacts: normalized.artifacts,
    checks: normalized.checks,
    decision: normalized.decision,
    error: null,
    provider_metadata: cloneCanonical(providerResult.provider_metadata),
    role_result: {
      kind: binding.role,
      raw_sha256: rawSha256,
      claimed: raw,
      verified,
    },
  };
  canonicalJson(result);
  return result;
}

module.exports = {
  MAX_CANONICAL_BYTES,
  canonicalJson,
  finalizeRoleResult,
};
