const CODEX_ACCOUNTS = Object.freeze(['team1', 'team2', 'team3', 'team4', 'team5']);
const MACHINES = Object.freeze(['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1']);

const VERIFIED_TARGETS = Object.freeze([
  ...CODEX_ACCOUNTS.flatMap((account) => (
    MACHINES.map((machine) => Object.freeze({ provider: 'codex', account, machine }))
  )),
  Object.freeze({ provider: 'claude', account: 'account1', machine: 'us-mac-m4' }),
  Object.freeze({ provider: 'claude', account: 'account2', machine: 'us-mac-m4' }),
  Object.freeze({ provider: 'grok', account: 'grok', machine: 'us-mac-m4' }),
]);

function targetKey(target) {
  return `${target?.provider ?? ''}:${target?.account ?? ''}:${target?.machine ?? ''}`;
}

const VERIFIED_TARGET_KEYS = new Set(VERIFIED_TARGETS.map(targetKey));

export function listVerifiedExecutionTargets() {
  return VERIFIED_TARGETS.map((target) => ({ ...target }));
}

export function isVerifiedExecutionTarget(target) {
  return VERIFIED_TARGET_KEYS.has(targetKey(target));
}

function isExhausted(target, exhaustedTargets) {
  const key = targetKey(target);
  return (exhaustedTargets ?? []).some((entry) => targetKey(entry) === key);
}

export function resolveExecutionTarget({
  preferred_target: preferredTarget,
  candidates = [],
  exhausted_targets: exhaustedTargets = [],
  failure_class: failureClass = 'none',
  task_bundle: taskBundle,
} = {}) {
  if (isVerifiedExecutionTarget(preferredTarget)
      && !isExhausted(preferredTarget, exhaustedTargets)) {
    return {
      status: 'ok',
      target: { ...preferredTarget },
      fallback_reason: 'preferred_target_healthy',
      task_bundle: taskBundle,
    };
  }

  const target = candidates.find((candidate) => (
    isVerifiedExecutionTarget(candidate) && !isExhausted(candidate, exhaustedTargets)
  ));
  if (!target) {
    return {
      status: 'blocked',
      failure_class: failureClass === 'none' ? 'infrastructure_blocked' : failureClass,
      fallback_reason: 'all_execution_targets_exhausted',
      task_bundle: taskBundle,
    };
  }

  const result = {
    status: 'ok',
    target: { ...target },
    fallback_reason: target.provider !== 'codex'
      ? 'usm4_cross_vendor_fallback'
      : 'execution_target_fallback',
    task_bundle: taskBundle,
  };
  if (preferredTarget?.provider === 'codex'
      && target.provider === 'codex'
      && preferredTarget.machine !== target.machine) {
    result.recovery_mode = 'fresh_attempt';
    result.resume_session = false;
    result.truth_sources = ['git', 'pr', 'db'];
  }
  return result;
}

