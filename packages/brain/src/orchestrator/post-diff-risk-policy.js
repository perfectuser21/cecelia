import { createHash } from 'node:crypto';

export const POST_DIFF_RISK_POLICY_VERSION = 'kernel-post-diff-risk/v1';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const RISK_SCORE = Object.freeze({ low: 0, medium: 1, high: 2 });
const MAX_SMALL_FILES = 5;
const MAX_SMALL_CHANGED_LINES = 200;
const ASSESSMENT_TTL_MS = 15 * 60_000;

function immutable(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) immutable(child);
  }
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function canonicalContractDigest(value) {
  const canonical = typeof value === 'string'
    ? value
    : JSON.stringify(stableValue(value));
  if (typeof canonical !== 'string' || canonical.length === 0) {
    throw new Error('post_diff_contract_invalid');
  }
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

function validPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1024
    && !value.startsWith('/')
    && !/[\r\n\\\0]/.test(value)
    && !value.split('/').some((part) => part === '' || part === '.' || part === '..');
}

function normalizedFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 1_000) {
    throw new Error('post_diff_files_invalid');
  }
  const normalized = files.map((file) => {
    if (
      !file
      || typeof file !== 'object'
      || Array.isArray(file)
      || !validPath(file.path)
      || !Number.isInteger(file.additions)
      || file.additions < 0
      || !Number.isInteger(file.deletions)
      || file.deletions < 0
    ) {
      throw new Error('post_diff_file_invalid');
    }
    return {
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(normalized.map(({ path }) => path)).size !== normalized.length) {
    throw new Error('post_diff_file_duplicate');
  }
  return normalized;
}

export function canonicalDiffHash(files) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(normalizedFiles(files)), 'utf8')
    .digest('hex')}`;
}

function classForPath(path) {
  const lower = path.toLowerCase();
  if (/^(?:packages\/brain\/)?migrations\//.test(lower)) return 'migration';
  if (
    lower.startsWith('.github/workflows/')
    || lower.startsWith('packages/engine/ci/')
    || lower.startsWith('scripts/devgate/')
    || /(?:^|\/)ci(?:\.|\/|-)/.test(lower)
  ) return 'ci_workflow';
  if (
    /(?:credential|secret|security|oauth|auth-token|token-broker|credential-broker)/.test(lower)
  ) return 'security_credential';
  if (
    /(?:^|[-_/])(?:deploy|deployment|release|rollout|promote)(?:\/|[-_.])/.test(lower)
    || /(?:^|\/)dockerfile$/.test(lower)
  ) return 'deploy_release';
  if (
    lower.startsWith('packages/brain/src/orchestrator/')
    || lower.startsWith('packages/brain/src/routes/harness')
    || lower.startsWith('packages/brain/scripts/fleet-worker/')
  ) return 'core_orchestration';
  if (
    lower.startsWith('apps/')
    || lower.startsWith('packages/brain/src/')
    || lower.startsWith('packages/engine/src/')
  ) return 'application';
  if (lower.startsWith('docs/') || lower.endsWith('.md')) return 'docs';
  if (/(?:^|\/)(?:test|tests|__tests__)(?:\/|[-_.])/.test(lower)) return 'test';
  return 'unknown';
}

export function classifyChangedPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((path) => !validPath(path))) {
    return Object.freeze({
      path_class: 'unknown',
      protected: true,
      classes: Object.freeze(['unknown']),
    });
  }
  const classes = [...new Set(paths.map(classForPath))].sort();
  const pathClass = classes.length === 1 ? classes[0] : 'mixed';
  const protectedClass = !['application', 'docs', 'test'].includes(pathClass);
  return Object.freeze({
    path_class: pathClass,
    protected: protectedClass,
    classes: Object.freeze(classes),
  });
}

function elevate(current, requested) {
  if (!Object.hasOwn(RISK_SCORE, requested)) return 'high';
  return RISK_SCORE[requested] > RISK_SCORE[current] ? requested : current;
}

function addReason(state, reason, risk) {
  if (!state.reasons.includes(reason)) state.reasons.push(reason);
  state.risk = elevate(state.risk, risk);
}

function validReceipt(receipt) {
  return receipt
    && typeof receipt === 'object'
    && !Array.isArray(receipt)
    && receipt.receipt_status === 'confirmed';
}

export function assessPostDiffRisk(input = {}) {
  const state = { risk: 'low', reasons: [] };
  const nowMs = typeof input.now === 'function' ? input.now() : Date.now();
  const policyVersion = input.policyVersion ?? POST_DIFF_RISK_POLICY_VERSION;
  let files = null;
  let diffHash = null;
  let classification = {
    path_class: 'unknown',
    protected: true,
    classes: ['unknown'],
  };

  try {
    files = normalizedFiles(input.files);
    diffHash = canonicalDiffHash(files);
    classification = classifyChangedPaths(files.map(({ path }) => path));
  } catch {
    addReason(state, 'ground_truth_unknown', 'high');
  }

  const contract = input.contract ?? {};
  const bindingsKnown = UUID_PATTERN.test(input.taskId ?? '')
    && UUID_PATTERN.test(input.runId ?? '')
    && Number.isInteger(input.hop)
    && input.hop > 0
    && SHA_PATTERN.test(input.headSha ?? '')
    && DIGEST_PATTERN.test(diffHash ?? '')
    && Number.isInteger(contract.version)
    && contract.version > 0
    && DIGEST_PATTERN.test(contract.digest ?? '')
    && VERSION_PATTERN.test(input.behaviorVersion ?? '')
    && VERSION_PATTERN.test(policyVersion)
    && Number.isFinite(nowMs);
  if (!bindingsKnown) addReason(state, 'ground_truth_unknown', 'high');

  if (classification.protected) {
    addReason(state, `protected:${classification.path_class}`, 'high');
  }

  if (files) {
    const changedLines = files.reduce(
      (total, file) => total + file.additions + file.deletions,
      0,
    );
    if (files.length > MAX_SMALL_FILES || changedLines > MAX_SMALL_CHANGED_LINES) {
      addReason(state, 'diff_not_small', 'medium');
    }
  }

  if (input.changeSignals?.newCapability === true) {
    addReason(state, 'new_capability', 'high');
  }

  const receipt = input.productionReceipt;
  if (receipt == null) {
    addReason(state, 'first_behavior', 'medium');
  } else if (!validReceipt(receipt)) {
    addReason(state, 'production_proof_unknown', 'high');
  } else {
    const receiptExpiry = Date.parse(receipt.expires_at);
    if (!Number.isFinite(receiptExpiry) || receiptExpiry <= nowMs) {
      addReason(state, 'production_proof_expired', 'high');
    }
    if (receipt.behavior_version !== input.behaviorVersion) {
      addReason(state, 'behavior_version_changed', 'high');
    }
    if (
      receipt.contract_version !== contract.version
      || receipt.contract_digest !== contract.digest
    ) {
      addReason(state, 'contract_changed', 'high');
    }
    if (receipt.path_class !== classification.path_class) {
      addReason(state, 'path_class_changed', 'high');
    }
    if (!SHA_PATTERN.test(receipt.production_head_sha ?? '')) {
      addReason(state, 'production_proof_unknown', 'high');
    }
  }

  if (input.evidence?.ci !== 'pass') addReason(state, 'ci_not_green', 'medium');
  if (input.evidence?.evaluator !== 'PASS') {
    addReason(state, 'evaluator_not_green', 'medium');
  }
  if (input.evidence?.judge !== 'PASS') addReason(state, 'judge_not_green', 'medium');

  const callerRisk = input.callerRisk ?? 'low';
  if (!Object.hasOwn(RISK_SCORE, callerRisk)) {
    addReason(state, 'caller_risk_unknown', 'high');
  } else if (RISK_SCORE[callerRisk] > RISK_SCORE[state.risk]) {
    state.risk = callerRisk;
    state.reasons.push('caller_risk_elevated');
  }

  const autoEligible = bindingsKnown
    && state.risk === 'low'
    && state.reasons.length === 0;
  const proof = {
    schema_version: POST_DIFF_RISK_POLICY_VERSION,
    policy_version: policyVersion,
    risk_level: state.risk,
    human_review_required: !autoEligible,
    auto_eligible: autoEligible,
    reasons: state.reasons,
    bindings: {
      task_id: input.taskId ?? null,
      run_id: input.runId ?? null,
      hop: Number.isInteger(input.hop) ? input.hop : null,
      head_sha: input.headSha ?? null,
      diff_hash: diffHash,
      contract_version: Number.isInteger(contract.version) ? contract.version : null,
      contract_digest: contract.digest ?? null,
      behavior_version: input.behaviorVersion ?? null,
      path_class: classification.path_class,
    },
    expires_at: Number.isFinite(nowMs)
      ? new Date(nowMs + ASSESSMENT_TTL_MS).toISOString()
      : null,
  };
  return immutable(proof);
}

export const __test__ = {
  classForPath,
  normalizedFiles,
};
