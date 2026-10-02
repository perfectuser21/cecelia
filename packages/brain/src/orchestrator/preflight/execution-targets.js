import { directory } from '../../execution-directory/directory.js';
import { MACHINES, MACHINE_ROLES } from '../../machine-registry.js';

function targetKey(target) {
  return `${target?.provider ?? ''}:${target?.account ?? ''}:${target?.machine ?? ''}`;
}



export function listVerifiedExecutionTargets() {
  return directory.targets();
}

export function isVerifiedExecutionTarget(target) {
  return listVerifiedExecutionTargets().some(t => targetKey(t) === targetKey(target));
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
    for (const verified of listVerifiedExecutionTargets()) {
      if (verified.provider === target?.provider && verified.machine === target?.machine) {
        push({ ...target, account: verified.account });
      }
    }
  }
  return expanded;
}

// runtime所在机器是调度器落点，不是用户pin；只对无显式机器策略的Codex使用缺省顺序。
const MACHINE_TARGET_KEYS = ['machine', 'machineId', 'machine_id', 'requested_machine_id', 'executor_machine', 'preferred_machine'];
const MACHINE_POLICY_KEYS = [...MACHINE_TARGET_KEYS, 'strict_affinity', 'fallback_targets', 'fallback_policy', 'fallback_strategy'];
export function hasUnsupportedMachinePolicy(payload, roleAssignment) {
  const policies = [
    [payload, ['machine', 'machine_id', 'requested_machine_id', 'executor_machine']],
    [payload.routing ?? {}, ['preferred_machine']],
    [roleAssignment, ['machine']],
  ];
  return policies.some(([policy, supported]) => MACHINE_TARGET_KEYS.some(
    key => Object.hasOwn(policy, key) && !supported.includes(key),
  ));
}
export function defaultCodexTargets({role, provider, account, model, candidateMachine, payload = {}, roleAssignment = {}, repo}) {
  const policies = [payload, payload.routing ?? {}, roleAssignment];
  if (role === 'commander' || provider !== 'codex' || candidateMachine
      || policies.some(policy => MACHINE_POLICY_KEYS.some(key => Object.hasOwn(policy, key)))) return null;
  const requested = [MACHINE_ROLES.SECONDARY, MACHINE_ROLES.PRIMARY]
    .flatMap(role => MACHINES.filter(machine => machine.machineRole === role))
    .map(({id: machine}) => ({
    provider, account, ...(model ? {model} : {}), machine,
  }));
  return expandUnresolvedAccountTargets(requested).filter(target => directory.matches({
    machineId: target.machine, surface: 'harness', provider: target.provider, account: target.account, repo,
  }));
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

