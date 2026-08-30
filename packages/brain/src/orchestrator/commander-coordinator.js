import { randomUUID } from 'node:crypto';

import { buildCommanderBundle } from './commander-bundle.js';
import {
  classifyCommanderWakeup,
  materialEventsAfter,
} from './commander-wakeup.js';

const ACTIVE_ATTEMPT_STATUSES = new Set(['queued', 'starting', 'running']);
const INFRASTRUCTURE_FAILURE_CLASSES = new Set([
  'infrastructure_blocked',
  'runner_failure',
]);
const COMMANDER_FAILOVER_CODES = new Set([
  'auth_failed',
  'http_429',
  'rate_limit',
  'http_500',
  'http_502',
  'http_503',
  'http_504',
  'provider_unavailable',
  'provider_transient_retry_exhausted',
  'session_unrecoverable',
  'launch_failed',
]);

function maxCursor(events, fallback) {
  return events.reduce(
    (current, candidate) => Math.max(current, Number(candidate.cursor) || 0),
    fallback,
  );
}

function commanderHistory(state, historySummary) {
  return {
    ...historySummary,
    strategy_summary: state.strategy_summary ?? {},
    latest_guidance: state.latest_guidance ?? null,
  };
}

function targetKey(target) {
  return [
    target?.provider ?? '',
    target?.account ?? target?.account_id ?? '',
    target?.machine ?? target?.requested_machine_id ?? '',
  ].join('\u0000');
}

function declaredTargets(input) {
  const commander = input.runProfile?.commander;
  if (!commander?.primary) throw new Error('commander_primary_target_missing');
  return [commander.primary, ...(commander.fallbacks ?? [])];
}

function humanReviewDecision(input, reason) {
  // 第 48 批：拟判死（phase=failed）升人审时相位落 review——人审是停表等人，不是终局。
  const phase = input.defaultDecision.phase === 'failed' ? 'review' : input.defaultDecision.phase;
  return {
    kind: 'continue',
    decision: {
      phase,
      action: 'wait:human_review',
      reason,
    },
  };
}

// r60 run 918422f4 案卷（第 29 批件①）：Commander 是监理不是承重墙。基础设施类
// 失败（lease 过期/容器死/5xx）穷尽 failover 后不再人审停工——降级 continue 走
// kernel 默认决策（kernel-only 语义，长期验证安全），decision.reason 带 degraded
// 标记留痕。semantic_refusal（Commander 明确拒绝，可能发现真问题）不走此路。
function degradeToKernelDecision(input, reason) {
  return {
    kind: 'continue',
    degraded: true,
    degraded_reason: reason,
    decision: {
      ...input.defaultDecision,
    },
  };
}

// 第 48 批（r83 案卷）：基础设施类失败一律可 failover——r83 的 Commander 因
// worker_attempt_replacement_required_after_lease（infrastructure_blocked）失败，错误码不在
// 白名单 → 被判"不可 failover" → 状态永久 failed → 7h 无人会诊 → deadline 静默判死。
// 错误码白名单只作补充（failure_class 缺失时仍可按码放行）。
function isFailoverEligible(attempt) {
  return ['failed', 'cancelled'].includes(attempt?.status)
    && (
      INFRASTRUCTURE_FAILURE_CLASSES.has(attempt?.failure_class)
      || COMMANDER_FAILOVER_CODES.has(attempt?.error_code)
    );
}

function requireDependency(value, name, method) {
  if (!value || typeof value[method] !== 'function') {
    throw new Error(`createCommanderCoordinator requires ${name}.${method}`);
  }
}

export function createCommanderCoordinator({
  commanderStore,
  eventStore,
  actorInbox,
  attemptStore,
  appendDecision,
  nextHop,
  now,
}) {
  requireDependency(commanderStore, 'commanderStore', 'ensureRun');
  requireDependency(commanderStore, 'commanderStore', 'get');
  requireDependency(commanderStore, 'commanderStore', 'updateMemory');
  requireDependency(commanderStore, 'commanderStore', 'advanceCursor');
  requireDependency(eventStore, 'eventStore', 'list');
  requireDependency(actorInbox, 'actorInbox', 'list');
  requireDependency(attemptStore, 'attemptStore', 'getLatestCommanderAttempt');
  requireDependency(
    attemptStore,
    'attemptStore',
    'listCommanderFailoverLineage',
  );
  if (typeof appendDecision !== 'function') {
    throw new Error('createCommanderCoordinator requires appendDecision');
  }
  if (typeof nextHop !== 'function') {
    throw new Error('createCommanderCoordinator requires nextHop');
  }
  if (typeof now !== 'function') {
    throw new Error('createCommanderCoordinator requires now');
  }

  async function appendCommanderDecision(input, {
    action,
    gateVerdict,
    attemptId,
    reasonCode = null,
    directive = null,
  }) {
    const hop = await nextHop(input.run.id);
    await appendDecision({
      runId: input.run.id,
      hop,
      observed: {
        commander_attempt_id: attemptId,
        event_cursor: directive?.event_cursor ?? null,
      },
      derivedPhase: input.defaultDecision.phase,
      gateVerdict,
      action,
      detail: {
        attempt_id: attemptId,
        ...(reasonCode ? { reason_code: reasonCode } : {}),
        ...(directive ? { directive } : {}),
      },
    });
    return hop;
  }

  async function actorMessages(runId) {
    const afterCursor = typeof actorInbox.getCursor === 'function'
      ? await actorInbox.getCursor(runId, 'commander')
      : 0;
    return actorInbox.list({
      runId,
      actorKey: 'commander',
      afterCursor,
      limit: 200,
    });
  }

  async function createDispatch(input, currentState, {
    events,
    reasons,
    targets,
    logicalCycleId = null,
    retryOfAttemptId = null,
    restartReason = null,
    eventCursor = null,
  }) {
    const [target] = targets;
    if (!target) throw new Error('commander_dispatch_target_missing');
    const attemptId = randomUUID();
    const bundle = buildCommanderBundle({
      eventCursor,
      runId: input.run.id,
      commanderAttemptId: attemptId,
      state: currentState,
      runProfile: input.runProfile,
      objective: input.objective,
      observed: input.observed,
      historySummary: commanderHistory(currentState, input.historySummary),
      newEvents: events,
      actorMessages: await actorMessages(input.run.id),
      activeRisks: currentState.active_risks ?? [],
      budgets: input.budgets,
      allowedActions: input.allowedActions,
    });

    return {
      kind: 'dispatch',
      action: 'spawn:commander',
      context: {
        target,
        candidate_targets: targets,
        bundle,
        wakeup_reasons: reasons,
        logical_cycle_id: logicalCycleId
          ?? `commander-wakeup:${bundle.event_cursor}`,
        ...(retryOfAttemptId
          ? { retry_of_attempt_id: retryOfAttemptId }
          : {}),
        ...(restartReason ? { restart_reason: restartReason } : {}),
        requested_at: now().toISOString(),
      },
    };
  }

  async function dispatchFor(input, currentState, newEvents, { eventCursor = null } = {}) {
    const wakeup = classifyCommanderWakeup({
      runId: input.run.id,
      stateCursor: currentState.event_cursor,
      events: newEvents,
      defaultDecision: input.defaultDecision,
    });
    if (!wakeup.wake) {
      return { kind: 'continue', decision: input.defaultDecision };
    }
    return createDispatch(input, currentState, {
      events: wakeup.events,
      reasons: wakeup.reasons,
      targets: declaredTargets(input),
      eventCursor,
    });
  }

  async function stopForHuman(input, currentState, newEvents, reason, latestAttempt = null) {
    const stopped = await commanderStore.updateMemory(input.run.id, {
      expectedCursor: currentState.event_cursor,
      status: 'failed',
    });
    if (!stopped) return { kind: 'wait', reason: 'commander_cursor_conflict' };
    // 第 48 批：Commander 停机必须留痕——r83 的停机无行无日志，7h 后才在尸检里看见。
    await appendCommanderDecision(input, {
      action: 'commander.stopped',
      gateVerdict: `deny:${reason}`,
      attemptId: latestAttempt?.id ?? null,
      reasonCode: reason,
    });
    const nextCursor = maxCursor(newEvents, currentState.event_cursor);
    const advanced = await commanderStore.advanceCursor(input.run.id, {
      expectedCursor: currentState.event_cursor,
      nextCursor,
    });
    if (!advanced) return { kind: 'wait', reason: 'commander_cursor_conflict' };
    if (reason !== 'commander_semantic_refusal') {
      return degradeToKernelDecision(input, reason);
    }
    return humanReviewDecision(input, reason);
  }

  // 第 48 批（r83 案卷）：Commander 状态 failed 后遇拟判死（默认决策 mark_failed）——
  // 此前直接降级 continue = 机械层判死照旧执行，"交 Commander 会诊"是一句空话。
  // 现改为：先复活一次（重置 ready + 新派 Commander，谱系 commander-revive:<run>），
  // 复活谱系已存在仍拟判死 → 升人审停表，由人裁决；非拟判死场景保持降级（第 29 批语义）。
  async function reviveOrPark(input, currentState, latestAttempt) {
    const reviveCycle = `commander-revive:${input.run.id}`;
    const revived = await attemptStore.listCommanderFailoverLineage(input.run.id, reviveCycle);
    if (revived.length > 0 || latestAttempt?.logical_cycle_id === reviveCycle) {
      return humanReviewDecision(input, 'commander_unavailable_pre_terminal');
    }
    const ready = await commanderStore.updateMemory(input.run.id, {
      expectedCursor: currentState.event_cursor,
      status: 'ready',
    });
    if (!ready) return { kind: 'wait', reason: 'commander_cursor_conflict' };
    const authoritativeHop = await appendCommanderDecision(input, {
      action: 'commander.revived',
      gateVerdict: 'allow',
      attemptId: latestAttempt?.id ?? null,
      reasonCode: 'commander_revive_pre_terminal',
    });
    const dispatch = await createDispatch(input, currentState, {
      events: [],
      reasons: ['kernel_pre_terminal', 'commander_revive'],
      targets: declaredTargets(input),
      logicalCycleId: reviveCycle,
      restartReason: 'commander_revive',
    });
    return { ...dispatch, authoritative_hop: authoritativeHop };
  }

  async function failoverFrom(input, currentState, latestAttempt, newEvents) {
    if (currentState.status === 'failed') {
      if (input.defaultDecision?.action === 'mark_failed') {
        return reviveOrPark(input, currentState, latestAttempt);
      }
      return degradeToKernelDecision(input, 'commander_failover_exhausted');
    }
    if (!isFailoverEligible(latestAttempt)) {
      const reason = latestAttempt.failure_class === 'semantic_refusal'
        ? 'commander_semantic_refusal'
        : 'commander_failure_not_failover_eligible';
      return stopForHuman(input, currentState, newEvents, reason, latestAttempt);
    }

    const logicalCycleId = latestAttempt.logical_cycle_id;
    if (!logicalCycleId) {
      return stopForHuman(
        input,
        currentState,
        newEvents,
        'commander_failover_lineage_missing',
        latestAttempt,
      );
    }
    const lineage = await attemptStore.listCommanderFailoverLineage(
      input.run.id,
      logicalCycleId,
    );
    const attemptedTargets = new Set(lineage.map(targetKey));
    const targets = declaredTargets(input);
    const currentIndex = targets.findIndex(
      (target) => targetKey(target) === targetKey(latestAttempt),
    );
    const candidates = targets
      .slice(currentIndex < 0 ? targets.length : currentIndex + 1)
      .filter((target) => !attemptedTargets.has(targetKey(target)));

    if (candidates.length === 0) {
      const authoritativeHop = await appendCommanderDecision(input, {
        action: 'commander.failover_completed',
        gateVerdict: 'deny:all_execution_targets_exhausted',
        attemptId: latestAttempt.id,
        reasonCode: 'all_execution_targets_exhausted',
      });
      const stopped = await stopForHuman(
        input,
        currentState,
        newEvents,
        'commander_failover_exhausted',
        latestAttempt,
      );
      return {
        ...stopped,
        authoritative_hop: authoritativeHop,
      };
    }

    const authoritativeHop = await appendCommanderDecision(input, {
      action: 'commander.failover_started',
      gateVerdict: 'allow',
      attemptId: latestAttempt.id,
      reasonCode: latestAttempt.error_code,
    });
    const dispatch = await createDispatch(input, currentState, {
      events: newEvents,
      reasons: [`commander_failover:${latestAttempt.error_code}`],
      targets: candidates,
      logicalCycleId,
      retryOfAttemptId: latestAttempt.id,
      restartReason: `commander_failover:${latestAttempt.error_code}`,
    });
    return {
      ...dispatch,
      authoritative_hop: authoritativeHop,
    };
  }

  async function reconcile(input) {
    if (input.commanderMode !== 'hybrid') return { kind: 'bypass' };
    const runId = input.run?.id;
    if (!runId) throw new Error('commander_run_id_missing');

    await commanderStore.ensureRun({ runId });
    const currentState = await commanderStore.get(runId);
    if (!currentState || currentState.run_id !== runId) {
      throw new Error('commander_state_missing');
    }

    const latestAttempt = await attemptStore.getLatestCommanderAttempt(runId);
    if (latestAttempt && ACTIVE_ATTEMPT_STATUSES.has(latestAttempt.status)) {
      return {
        kind: 'wait',
        reason: 'commander_attempt_inflight',
        attempt_id: latestAttempt.id,
      };
    }

    const newEvents = await eventStore.list(runId, {
      afterCursor: currentState.event_cursor,
      limit: 200,
    });
    if (!latestAttempt) {
      return dispatchFor(input, currentState, newEvents);
    }
    const directive = latestAttempt.result?.decision ?? null;
    if (latestAttempt.status !== 'completed' || !directive) {
      return failoverFrom(input, currentState, latestAttempt, newEvents);
    }

    const bundleCursor = Number(
      latestAttempt.task_bundle?.inputs?.commander_bundle?.event_cursor,
    );
    // 状态游标 > bundle 游标 = 该提案已被裁决消费（control 返回后 advanceCursor 是唯一的
    // 消费标记），此后每轮只按新 material 事件决定是否再唤醒。第 46 批（r80 案卷）：
    // 替换派发曾用 material 事件最大游标建 bundle、状态却推进到全部事件最大游标——
    // 提案天生"已消费"、从未裁决就被静默丢弃。修在下方替换派发处（eventCursor 对齐），
    // 此处消费语义保持不变。
    if (
      !Number.isSafeInteger(bundleCursor)
      || bundleCursor < 0
      || currentState.event_cursor > bundleCursor
    ) {
      return dispatchFor(input, currentState, newEvents);
    }

    const staleEvents = materialEventsAfter({
      runId,
      bundleCursor,
      events: newEvents,
      commanderAttemptId: latestAttempt.id,
    });
    const nextCursor = maxCursor(newEvents, currentState.event_cursor);
    if (staleEvents.length > 0) {
      const authoritativeHop = await appendCommanderDecision(input, {
        action: 'commander.directive_rejected',
        gateVerdict: 'deny:stale_event_cursor',
        attemptId: latestAttempt.id,
        reasonCode: 'stale_event_cursor',
        directive,
      });
      // 替换派发必须带 eventCursor=nextCursor：bundle 游标与状态游标对齐，下一轮不再
      // 天生滞后。滞后场景下 material 事件可能全在状态游标之前（classify 过滤掉 → 无
      // wake），但提案已被拒绝，不派替换就是把 Commander 静默踢出局——强制派。
      const wakeup = classifyCommanderWakeup({
        runId,
        stateCursor: currentState.event_cursor,
        events: staleEvents,
        defaultDecision: input.defaultDecision,
      });
      const replacement = await createDispatch(input, currentState, {
        events: wakeup.events,
        reasons: wakeup.reasons.length > 0 ? wakeup.reasons : ['stale_directive_replacement'],
        targets: declaredTargets(input),
        eventCursor: nextCursor,
      });
      const advanced = await commanderStore.advanceCursor(runId, {
        expectedCursor: currentState.event_cursor,
        nextCursor,
      });
      if (!advanced) {
        return { kind: 'wait', reason: 'commander_cursor_conflict' };
      }
      return {
        ...replacement,
        authoritative_hop: authoritativeHop,
      };
    }

    let authoritativeHop = null;
    if (
      latestAttempt.attempt_kind === 'retry'
      || latestAttempt.retry_of_attempt_id
    ) {
      authoritativeHop = await appendCommanderDecision(input, {
        action: 'commander.failover_completed',
        gateVerdict: 'allow',
        attemptId: latestAttempt.id,
      });
    }
    await commanderStore.updateMemory(runId, {
      expectedCursor: currentState.event_cursor,
      provider: latestAttempt.provider,
      accountId: latestAttempt.account_id,
      providerSessionId: latestAttempt.provider_session_id,
      status: 'ready',
    });
    const advanced = await commanderStore.advanceCursor(runId, {
      expectedCursor: currentState.event_cursor,
      nextCursor,
    });
    if (!advanced) {
      return { kind: 'wait', reason: 'commander_cursor_conflict' };
    }
    return {
      kind: 'control',
      decision: directive,
      attempt_id: latestAttempt.id,
      event_cursor: bundleCursor,
      ...(authoritativeHop == null
        ? {}
        : { authoritative_hop: authoritativeHop }),
    };
  }

  return Object.freeze({ reconcile });
}
