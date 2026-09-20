import { randomUUID } from 'node:crypto';

import {
  isVerifiedExecutionTarget,
} from './execution-targets.js';

const SECRET_KEYS = /(?:^|_)(?:authorization|token|password|cookie)(?:$|_)/i;
const TRANSIENT_HTTP_STATUSES = new Set([500, 502, 503, 504]);
const TRANSIENT_SIGNATURE = /^(?:http_)?(?:500|502|503|504)$|^high_demand$|^biscuit_baker_.*_circuit_open$/;
const NODE_ADMISSION_SIGNATURES = new Set([
  'node_not_base_admitted',
  'node_not_dispatch_ready',
]);

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => (
    [key, SECRET_KEYS.test(key) ? '[REDACTED]' : redact(nested)]
  )));
}

export function buildCapabilityEvidence(input = {}) {
  return redact(input);
}

export function parseCapabilityRequirements(input = {}) {
  const source = asObject(
    input.contract_requirements
      ?? input.capability_requirements
      ?? input.requirements,
  );
  return {
    provider_auth: source.provider_auth === true,
    github: source.github === true,
    postgres: source.postgres === true,
    model_capabilities: Array.isArray(source.model_capabilities)
      ? [...source.model_capabilities]
      : [],
  };
}

export function classifyExecutionFailure({
  capability_matched: capabilityMatched,
  provider_result: providerResult,
} = {}) {
  if (capabilityMatched) {
    return {
      failure_class: 'product_failure',
      action: 'generator-fix',
      should_enter_generator_fix: true,
      provider_result: providerResult,
    };
  }
  return {
    failure_class: 'infrastructure_blocked',
    action: 'wait:human_review',
    should_enter_generator_fix: false,
    provider_result: providerResult,
  };
}

function transientProbeFailure(result) {
  if (result?.transient === true) return true;
  if (TRANSIENT_HTTP_STATUSES.has(Number(result?.http_status))) return true;
  return TRANSIENT_SIGNATURE.test(String(result?.signature ?? ''));
}

function failureSignature(result) {
  return String(result?.signature ?? result?.http_status ?? 'unknown_provider_failure');
}

function targetKey(target) {
  return `${target?.provider ?? ''}:${target?.account ?? ''}:${target?.machine ?? ''}`;
}

function withTimeout(operation, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('preflight_timeout')), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function blockedResult({
  snapshotId,
  fromTarget,
  fallbackReason,
  probeDetail,
  failureClass = 'infrastructure_blocked',
  quotaEvidence = null,
}) {
  const evidence = buildCapabilityEvidence({
    capability_snapshot_id: snapshotId,
    from_target: fromTarget,
    to_target: null,
    fallback_reason: fallbackReason,
    failure_class: failureClass,
    ...(probeDetail ? { probe_detail: probeDetail } : {}),
    ...(quotaEvidence ?? {}),
  });
  return {
    status: 'blocked',
    action: 'wait:human_review',
    failure_class: failureClass,
    fallback_reason: fallbackReason,
    should_create_attempt: false,
    should_enter_generator_fix: false,
    evidence,
  };
}

export function createCapabilityGate(deps = {}) {
  const now = deps.now ?? Date.now;
  const probeTimeoutMs = Number(deps.probeTimeoutMs ?? 200);
  const snapshotTtlMs = Number(deps.snapshotTtlMs ?? 1_000);
  const retryExhausted = new Set();
  const exhaustedAccounts = new Set();

  async function probe(operation) {
    return withTimeout(operation, probeTimeoutMs);
  }

  async function evaluate({
    preferred_target: preferredTarget,
    candidate_targets: candidateTargets,
    failed_targets: failedTargets = [],
    requirements: rawRequirements,
    task_bundle: taskBundle,
  }) {
    const requirements = parseCapabilityRequirements({ requirements: rawRequirements });
    const snapshotId = randomUUID();
    const logicalCycle = taskBundle?.logical_cycle ?? null;
    const candidates = Array.isArray(candidateTargets) && candidateTargets.length > 0
      ? candidateTargets
      : [preferredTarget];
    const failedTargetKeys = new Set(failedTargets.map(targetKey));
    let machine;
    let health;
    let capacity;
    let fallbackReason = 'all_execution_targets_exhausted';
    let lastProviderProbe = null;
    let lastNodeProbe = null;
    let selectedTarget = null;
    let providerAuth = null;
    const quotaUnusable = [];   // 因配额/标记判死的候选（含当时的 health/capacity，供保底复用）
    const quotaAbstained = [];  // 弃权的候选
    let quotaGateError = null;

    let quotaSnapshot = null;
    if (typeof deps.loadAccountQuota === 'function') {
      try {
        quotaSnapshot = await probe(() => deps.loadAccountQuota());
      } catch (error) {
        // 不再静默：吞掉异常等于闸门无痕消失（2026-08-19 事故形状）
        quotaGateError = error.message === 'preflight_timeout'
          ? 'account_quota_probe_timeout'
          : `account_quota_gate_error:${String(error?.message ?? error).slice(0, 120)}`;
        await deps.emitAlert?.({
          kind: 'kernel_account_quota_gate_degraded',
          reason: quotaGateError,
        });
      }
    }

    for (const candidate of candidates) {
      if (failedTargetKeys.has(targetKey(candidate))) continue;
      if (!isVerifiedExecutionTarget(candidate)) continue;

      machine = candidate.machine;
      try {
        health = await probe(() => deps.getMachineHealth({ machine, task_bundle: taskBundle }));
        capacity = await probe(() => deps.getMachineCapacity({ machine, task_bundle: taskBundle }));
      } catch (error) {
        if (error.message === 'preflight_timeout') {
          fallbackReason = 'preflight_timeout';
          continue;
        }
        continue;
      }
      if (!health?.ok || !capacity?.ok || Number(capacity?.available ?? 0) < 1) {
        lastNodeProbe = {
          machine_health: health ?? null,
          machine_capacity: capacity ?? null,
        };
        const admissionSignature = [health?.signature, capacity?.signature]
          .find((signature) => NODE_ADMISSION_SIGNATURES.has(signature));
        if (admissionSignature) {
          fallbackReason = admissionSignature;
        }
        continue;
      }

      const accountCycleKey = [
        logicalCycle,
        candidate.provider,
        candidate.account,
        candidate.machine,
      ].join(':');
      if (exhaustedAccounts.has(accountCycleKey)) {
        fallbackReason = 'logical_cycle_retry_exhausted';
        continue;
      }

      // 额度闸：凭据有效 ≠ 账号可用。
      // 2026-08-19 生产（run 4c867fb4 / 2150e1b7 / 80459597）：account1 七天额度 100%，
      // 但凭据完全有效 → probeProviderAuth 返回 ok → 直接选中 → 每个角色都撞 429 再重派；
      // publisher 撞上后没有重派余地，租约过期即 infrastructure_blocked，整跑作废。
      // 认证探针只回答"这个号能不能登录"，回答不了"这个号还有没有额度"，必须单独判。
      // 放在认证探针**之前**：额度已满的号连探针都不该浪费。
      // 未注入判据时 fail-open，保持既有行为（本闸只负责选号，准入 fail-closed 另有闸门）。
      // 两个判据取 OR：表判据看配额，内存标记看真撞过的 429/认证失败（表里无此列）。
      if (candidate?.account) {
        const v = quotaSnapshot ? quotaSnapshot.verdictFor(candidate.account) : null;

        let markerUsable = true;
        if (typeof deps.isAccountUsable === 'function') {
          try {
            // 同样包进 probe()：这里原本也是裸 await
            markerUsable = await probe(() => deps.isAccountUsable(candidate.account));
          } catch (error) {
            markerUsable = true; // 标记读不到时不判死，但必须留痕
            quotaGateError = quotaGateError
              ?? `account_marker_error:${String(error?.message ?? error).slice(0, 120)}`;
            await deps.emitAlert?.({
              kind: 'kernel_account_quota_gate_degraded',
              reason: quotaGateError,
            });
          }
        }

        if (v?.verdict === 'unusable' || markerUsable === false) {
          fallbackReason = 'account_quota_exhausted';
          // health/capacity 是循环外 let（:142-144），后续候选会覆盖 ——
          // 保底要用就必须此刻存下来，否则保底选中 A 却带着 B 的健康快照
          quotaUnusable.push({
            candidate: { ...candidate },
            account: candidate.account,
            reason: v?.verdict === 'unusable' ? v.reason : 'runtime_marker',
            pct: v?.pct ?? null,
            health,
            capacity,
          });
          continue;
        }
        if (v?.verdict === 'unknown') {
          quotaAbstained.push({ account: candidate.account, reason: v.reason });
        }
      }

      try {
        providerAuth = requirements.provider_auth
          ? await probe(() => deps.probeProviderAuth({ ...candidate, task_bundle: taskBundle }))
          : { ok: true, skipped: true };
      } catch (error) {
        if (error.message === 'preflight_timeout') {
          fallbackReason = 'preflight_timeout';
          continue;
        }
        providerAuth = { ok: false, signature: 'provider_probe_error' };
      }
      lastProviderProbe = providerAuth;
      if (providerAuth?.ok) {
        selectedTarget = { ...candidate };
        fallbackReason = targetKey(candidate) === targetKey(preferredTarget)
          ? 'preferred_target_healthy'
          : 'execution_target_fallback';
        break;
      }

      if (transientProbeFailure(providerAuth)) {
        const retryKey = [
          logicalCycle,
          candidate.provider,
          candidate.account,
          candidate.machine,
          failureSignature(providerAuth),
        ].join(':');
        if (!retryExhausted.has(retryKey)) {
          retryExhausted.add(retryKey);
          let retry;
          try {
            retry = await probe(() => deps.probeProviderAuth({
              ...candidate,
              task_bundle: taskBundle,
              recovery_retry: true,
            }));
          } catch (error) {
            if (error.message === 'preflight_timeout') {
              fallbackReason = 'preflight_timeout';
              continue;
            }
            retry = { ok: false, signature: 'provider_probe_error' };
          }
          lastProviderProbe = retry;
          if (retry?.ok) {
            selectedTarget = { ...candidate };
            fallbackReason = 'provider_transient_recovered';
            providerAuth = retry;
            break;
          }
          fallbackReason = 'provider_transient_retry_exhausted';
          exhaustedAccounts.add(accountCycleKey);
        } else {
          fallbackReason = 'logical_cycle_retry_exhausted';
          exhaustedAccounts.add(accountCycleKey);
        }
      }
    }

    // 全灭保底：8 个号全被配额判死时，放行 pct 最低的那个并标 degraded，
    // 而不是让 run 落 blocked —— loop.js:1917-1924 把 infrastructure_blocked
    // 排除在 blocked-streak 外，全灭不是判死而是每 90s 静默转圈到 run deadline。
    //
    // 三条不得破坏：① 只读不写 exhaustedAccounts（写了该号下一跳被永久踢出）；
    // ② 只做一次裸 probeProviderAuth，不复用瞬时重试逻辑（会二次写 retryExhausted
    //    并把 fallback_reason 改写成 provider_transient_retry_exhausted）；
    // ③ credential_invalid 不进保底候选 —— 对它跑认证探针必然失败，白耗预算。
    if (!selectedTarget && quotaUnusable.length > 0) {
      const eligible = quotaUnusable
        .filter((entry) => entry.reason !== 'credential_invalid')
        .sort((a, b) => (a.pct ?? Number.POSITIVE_INFINITY) - (b.pct ?? Number.POSITIVE_INFINITY));
      const pick = eligible[0];
      if (pick) {
        await deps.emitAlert?.({
          kind: 'kernel_account_quota_all_exhausted',
          admitted_account: pick.account,
          admitted_pct: pick.pct,
          candidates: quotaUnusable.map(({ account, reason, pct }) => ({ account, reason, pct })),
        });
        let degradedAuth = null;
        try {
          degradedAuth = requirements.provider_auth
            ? await probe(() => deps.probeProviderAuth({ ...pick.candidate, task_bundle: taskBundle }))
            : { ok: true, skipped: true };
        } catch {
          degradedAuth = { ok: false, signature: 'provider_probe_error' };
        }
        if (degradedAuth?.ok) {
          selectedTarget = { ...pick.candidate };
          providerAuth = degradedAuth;
          lastProviderProbe = degradedAuth;
          // 循环外 let 此刻停在最后一个候选的值上，必须写回保底候选自己的快照
          machine = pick.candidate.machine;
          health = pick.health;
          capacity = pick.capacity;
          fallbackReason = 'account_quota_degraded_admit';
        }
      }
    }

    const quotaEvidence = {
      ...(quotaUnusable.length
        ? { quota_unusable: quotaUnusable.map(({ account, reason, pct }) => ({ account, reason, pct })) }
        : {}),
      ...(quotaAbstained.length ? { quota_abstained: quotaAbstained } : {}),
      ...(quotaGateError ? { account_quota_gate_error: quotaGateError } : {}),
      ...(quotaSnapshot?.degraded
        ? { account_quota_gate_degraded: quotaSnapshot.degradedReason }
        : {}),
    };

    if (!selectedTarget) {
      const reason = failureSignature(lastProviderProbe) === 'credential_missing'
        ? 'credential_probe_mismatch'
        : fallbackReason === 'preflight_timeout'
          ? 'preflight_timeout'
          : NODE_ADMISSION_SIGNATURES.has(fallbackReason) && !lastProviderProbe
            ? fallbackReason
          : 'all_execution_targets_exhausted';
      const blocked = blockedResult({
        snapshotId,
        fromTarget: preferredTarget,
        fallbackReason: reason,
        probeDetail: lastProviderProbe ?? lastNodeProbe,
        quotaEvidence,
      });
      await deps.emitAlert?.({
        kind: 'kernel_capability_preflight_blocked',
        action: blocked.action,
        failure_class: blocked.failure_class,
        evidence: blocked.evidence,
      });
      await deps.recordDecision?.({
        action: blocked.action,
        evidence: {
          capability_snapshot_id: blocked.evidence.capability_snapshot_id,
          from_target: blocked.evidence.from_target,
          to_target: blocked.evidence.to_target,
          fallback_reason: blocked.evidence.fallback_reason,
          failure_class: blocked.evidence.failure_class,
        },
      });
      return blocked;
    }

    const capabilities = {
      provider_auth: providerAuth,
      github: { ok: true, skipped: true },
      postgres: { ok: true, skipped: true },
      model_capabilities: {},
    };

    const capabilityProbes = [
      ['github', requirements.github, () => deps.probeGitHub({
        target: selectedTarget,
        task_bundle: taskBundle,
      })],
      ['postgres', requirements.postgres, () => deps.probePostgres({
        target: selectedTarget,
        task_bundle: taskBundle,
      })],
    ];

    for (const [name, required, operation] of capabilityProbes) {
      if (!required) continue;
      try {
        capabilities[name] = await probe(operation);
      } catch (error) {
        return blockedResult({
          snapshotId,
          fromTarget: preferredTarget,
          fallbackReason: error.message === 'preflight_timeout'
            ? 'preflight_timeout'
            : `${name}_probe_error`,
        });
      }
      if (!capabilities[name]?.ok) {
        return blockedResult({
          snapshotId,
          fromTarget: preferredTarget,
          fallbackReason: capabilities[name]?.signature ?? `${name}_capability_missing`,
          probeDetail: capabilities[name],
        });
      }
    }

    for (const capability of requirements.model_capabilities) {
      let result;
      try {
        result = await probe(() => deps.probeModelCapability({
          capability,
          target: selectedTarget,
          task_bundle: taskBundle,
        }));
      } catch (error) {
        return blockedResult({
          snapshotId,
          fromTarget: preferredTarget,
          fallbackReason: error.message === 'preflight_timeout'
            ? 'preflight_timeout'
            : 'model_capability_probe_error',
        });
      }
      capabilities.model_capabilities[capability] = result;
      if (!result?.ok) {
        return blockedResult({
          snapshotId,
          fromTarget: preferredTarget,
          fallbackReason: result?.signature ?? 'model_capability_missing',
          probeDetail: result,
          failureClass: 'contract_capability_mismatch',
        });
      }
    }

    const createdAt = now();
    const snapshot = {
      provider: selectedTarget.provider,
      account: selectedTarget.account,
      machine: selectedTarget.machine,
      capabilities,
      verified: true,
      health,
      capacity,
      capability_snapshot_id: snapshotId,
      logical_cycle: logicalCycle,
      created_at: createdAt,
      expires_at: createdAt + snapshotTtlMs,
    };
    const evidence = buildCapabilityEvidence({
      capability_snapshot_id: snapshotId,
      from_target: preferredTarget,
      to_target: selectedTarget,
      machine_capacity: capacity,
      fallback_reason: fallbackReason,
      failure_class: targetKey(selectedTarget) === targetKey(preferredTarget)
        ? 'none'
        : 'infrastructure_blocked',
      ...quotaEvidence,
    });
    return {
      status: 'ok',
      snapshot,
      from_target: { ...preferredTarget },
      to_target: selectedTarget,
      fallback_reason: fallbackReason,
      should_create_attempt: true,
      evidence,
    };
  }

  async function validateSnapshotForDispatch(snapshot, taskBundle) {
    await deps.beforeDispatchSnapshotValidation?.({ snapshot, task_bundle: taskBundle });
    if (!snapshot?.verified || now() > snapshot.expires_at) {
      return blockedResult({
        snapshotId: snapshot?.capability_snapshot_id ?? randomUUID(),
        fromTarget: snapshot ? {
          provider: snapshot.provider,
          account: snapshot.account,
          machine: snapshot.machine,
        } : null,
        fallbackReason: 'capability_snapshot_expired',
      });
    }
    return { status: 'ok', snapshot };
  }

  return Object.freeze({ evaluate, validateSnapshotForDispatch });
}
