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

// run c06b79af 案卷：调用方未解析账号（account=null）的目标不在白名单，
// 会被 isVerifiedExecutionTarget 零探针跳过。此处按 (provider, machine) 展开为
// 白名单具体账号（保持白名单声明顺序）；显式账号目标原样保留并对展开结果去重。
export function expandUnresolvedAccountTargets(targets = []) {
  const expanded = [];
  const seen = new Set();
  const push = (target) => {
    const key = targetKey(target);
    if (seen.has(key)) return;
    seen.add(key);
    expanded.push(target);
  };
  for (const target of targets) {
    if (target?.account != null) {
      push({ ...target });
      continue;
    }
    for (const verified of VERIFIED_TARGETS) {
      if (verified.provider === target?.provider && verified.machine === target?.machine) {
        push({ ...target, account: verified.account });
      }
    }
  }
  return expanded;
}

function isExhausted(target, exhaustedTargets) {
  const key = targetKey(target);
  return (exhaustedTargets ?? []).some((entry) => targetKey(entry) === key);
}

// account-usage CAPPED 活数据消费（issue 7c9f427e）：is_account_capped 谓词由调用方从
// account-usage 单一事实源注入（消除双系统裂脑）。CAPPED 的 target 视为不可用，与 exhausted
// 同等跳过。降级铁律（PRD 边界）：未注入/抛错 → 按 !capped 语义安全处理，绝不因取用量数据
// 失败而 crash 或误跳过好账号；仅显式返回真值时才跳过（undefined/未注入=可用）。
function makeCappedCheck(isAccountCapped) {
  if (typeof isAccountCapped !== 'function') return () => false;
  return (target) => {
    try {
      return isAccountCapped(target);
    } catch {
      return false;
    }
  };
}

export function resolveExecutionTarget({
  preferred_target: preferredTarget,
  candidates = [],
  exhausted_targets: exhaustedTargets = [],
  failure_class: failureClass = 'none',
  is_account_capped: isAccountCapped,
  task_bundle: taskBundle,
} = {}) {
  const isCapped = makeCappedCheck(isAccountCapped);

  if (isVerifiedExecutionTarget(preferredTarget)
      && !isExhausted(preferredTarget, exhaustedTargets)
      && !isCapped(preferredTarget)) {
    return {
      status: 'ok',
      target: { ...preferredTarget },
      fallback_reason: 'preferred_target_healthy',
      task_bundle: taskBundle,
    };
  }

  const target = candidates.find((candidate) => (
    isVerifiedExecutionTarget(candidate)
      && !isExhausted(candidate, exhaustedTargets)
      && !isCapped(candidate)
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

