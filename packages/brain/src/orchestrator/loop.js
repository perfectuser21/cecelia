/**
 * loop.js —— reconcile loop 编排（DI 可测）。
 *
 * 每跳：collectGroundTruth → deriveCounters → derive（含 gates caps）→
 *   控制 action 自消费（exit / mark_failed / persist_contract_approval）
 *   | wait:* 只心跳+sleep（不派 dispatcher、不 append hop，避免日志灌水）
 *   | 派发 action：nextHop → appendHop（intent-before-dispatch）→ dispatch → 四态处理 → 心跳。
 *
 * 四态最小语义（spec，T3 细化分路）：DONE/DONE_WITH_CONCERNS 记 detail 继续；
 * NEEDS_CONTEXT/BLOCKED 记 detail 不推进，连续 2 次同态 → run failed（"绝不同模型无变化重试"铁律骨架版）。
 * SingletonConflictError → 立即退出（并发实例信号，交 watchdog）。
 *
 * deps：{pool, dispatch(action, ctx), sleep?, now?, host?, pid?, log?,
 *        collectGroundTruth?, appendHop?, nextHop?, writeHeartbeat?}（后四者可注入 fake）
 */
import { derive } from './derive.js';
import { mergeGate } from './gates.js';
import { deriveCounters } from './counters.js';
import { collectGroundTruth as defaultCollect } from './ground-truth.js';
import { appendHop as defaultAppendHop, nextHop as defaultNextHop, SingletonConflictError } from './decision-log.js';
import { writeHeartbeat as defaultWriteHeartbeat } from './heartbeat.js';
import { materializeApprovedContract } from './contract-store.js';
import { ACTION, LOG_ACTION, BLOCKED_SAME_STATE_CAP, POLL_INTERVAL_MS } from './constants.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** runId 缺省解析：task 当前挂着的最新 v2 run（双轨期 D7：过滤 orchestrator_version，防误伤 v1/LangGraph run） */
async function resolveRunId(pool, taskId) {
  const { rows } = await pool.query(
    `SELECT id FROM initiative_runs
      WHERE current_task_id = $1 AND orchestrator_version = 'v2'
      ORDER BY created_at DESC LIMIT 1`,
    [taskId],
  );
  if (!rows[0]) throw new Error(`runLoop: task ${taskId} 无对应 v2 initiative_runs 行（需先建 run）`);
  return rows[0].id;
}

function asPayload(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function frozenContractArtifacts(deps, observed, groundTruthPaths, approvedSha) {
  const payload = asPayload(observed.task?.payload);
  const sprintDir = String(payload.sprint_dir ?? '').replace(/\/$/, '');
  const prdPath = groundTruthPaths.prdPath
    ?? (sprintDir ? `${sprintDir}/sprint-prd.md` : 'sprint-prd.md');
  const contractPath = sprintDir ? `${sprintDir}/contract-draft.md` : 'contract-draft.md';
  const dodPath = sprintDir ? `${sprintDir}/contract-dod.md` : 'contract-dod.md';
  const paths = [prdPath, contractPath, dodPath];
  if (typeof deps.readGitFile !== 'function') return { missing: paths };
  const contents = [];
  for (const filePath of paths) {
    try {
      contents.push(deps.readGitFile(approvedSha, filePath));
    } catch {
      return { missing: [filePath] };
    }
  }
  const [prdContent, contractDraft, contractDod] = contents;
  return {
    missing: [],
    prdContent,
    contractContent: `${contractDraft}\n\n${contractDod}`,
  };
}

async function resolveGroundTruthPaths(pool, taskId) {
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const payload = asPayload(rows[0]?.payload);
  const sprintDir = String(payload.sprint_dir ?? '').replace(/\/$/, '');
  return {
    prdPath: sprintDir ? `${sprintDir}/sprint-prd.md` : 'sprint-prd.md',
    callbackResultPath: payload.callback_result_path ?? '.brain-result.json',
  };
}

/**
 * appendHop 的 observed 快照：摘要而非全量（jsonb 列，回放/streak 推导用）。
 * counters 的 streak 契约（spec 决策 5）：proposer/reviewer intent 行必须带
 * "上一跳产物出现与否"——propose_branch_advanced / verdict_parsed，从上一同类 intent 对比现查真相得出。
 */
function buildSnapshot(observed, counters, action) {
  const snapshot = {
    prdExists: observed.prdExists,
    contractApproved: observed.contract.approved,
    pr: observed.pr
      ? {
          url: observed.pr.url,
          state: observed.pr.state,
          mergeStateStatus: observed.pr.mergeStateStatus,
          ci: observed.pr.ci,
          merged: observed.pr.merged,
          head_sha: observed.pr.head_sha,
        }
      : null,
    inflightContainers: observed.inflight.containers.length,
    lastAgentExit: observed.lastAgentExit,
    proposeBranchRn: observed.proposeBranchRn,
    proposeBranchSha: observed.proposeBranchSha,
    counters,
  };
  const prev = (a) => {
    let best = null;
    for (const r of observed.decisionLog) {
      if (r.action === a && (best == null || r.hop > best.hop)) best = r;
    }
    return best;
  };
  if (action === ACTION.SPAWN_PROPOSER) {
    const prevProposer = prev(ACTION.SPAWN_PROPOSER);
    if (prevProposer) {
      const prevRn = prevProposer.observed?.proposeBranchRn;
      snapshot.propose_branch_advanced = typeof prevRn === 'number' ? observed.proposeBranchRn > prevRn : undefined;
    }
  }
  if (action === ACTION.SPAWN_REVIEWER) {
    const prevReviewer = prev(ACTION.SPAWN_REVIEWER);
    if (prevReviewer) {
      snapshot.verdict_parsed = observed.decisionLog.some(
        (r) => r.action === LOG_ACTION.VERDICT_REVIEWER && r.hop > prevReviewer.hop,
      );
    }
  }
  return snapshot;
}

async function markRunFailed(pool, runId, reason) {
  await pool.query(
    `UPDATE initiative_runs SET phase = 'failed', failure_reason = $2, updated_at = NOW() WHERE id = $1`,
    [runId, reason],
  );
}

async function loadRunDeadline(pool, runId) {
  const { rows } = await pool.query(
    'SELECT deadline_at FROM initiative_runs WHERE id = $1',
    [runId],
  );
  return rows[0]?.deadline_at ?? null;
}

/**
 * runLoop(deps, {taskId, runId?, dryRun?}) → {exitReason, hops, decision?}
 * hops = 本进程实际派发（appendHop 成功）的跳数。
 * dryRun（F5 前台雏形）：只观测+推导+打印，单跳即返回，零写入零派发。
 */
export async function runLoop(deps, { taskId, runId, dryRun = false }) {
  const collect = deps.collectGroundTruth ?? defaultCollect;
  // DI 包装：fake（测试）注入 appendHop(opts) 单对象接口；默认实现是 (pool, opts) 两参数接口
  const append = deps.appendHop
    ? (_pool, opts) => deps.appendHop(opts)
    : defaultAppendHop;
  const next = deps.nextHop ?? defaultNextHop;
  const heartbeat = deps.writeHeartbeat ?? defaultWriteHeartbeat;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? console.log;
  const host = deps.host ?? 'unknown-host';
  const pid = deps.pid ?? process.pid;

  const resolvedRunId = runId ?? (await resolveRunId(deps.pool, taskId));
  const groundTruthPaths = collect === defaultCollect
    ? await resolveGroundTruthPaths(deps.pool, taskId)
    : {};

  let hops = 0;
  let blockedState = null;

  const beat = () => heartbeat(deps.pool, { runId: resolvedRunId, host, pid, now: now() });

  // deadline fence 辅助：检查 run.deadline_at 是否已超过当前时间
  function deadlineExceeded(run) {
    if (!run || !run.deadline_at) return false;
    return now() >= new Date(run.deadline_at);
  }

  while (true) {
    // ---- Deadline fence 1：collect 前 ----
    // collect 会调用 git/gh/docker，过期 run 不应再触发任何外部观测。
    const deadlineAt = await loadRunDeadline(deps.pool, resolvedRunId);
    if (deadlineExceeded({ deadline_at: deadlineAt })) {
      await markRunFailed(deps.pool, resolvedRunId, 'automation_deadline_exceeded');
      return { exitReason: 'automation_deadline_exceeded', hops };
    }

    const observed = await collect(deps, {
      taskId,
      runId: resolvedRunId,
      ...groundTruthPaths,
    });

    const counters = deriveCounters(observed.decisionLog, { proposeBranchMaxRn: observed.proposeBranchRn });
    // pollCount 从 DB 持久化推导（Sprint 07231527 Blocking 2：进程内变量改为 DB 推导）
    const pollCount = counters.pollCount;
    const fullCounters = { ...counters, pollCount, ganCostUsd: Number(observed.run.cost_usd ?? 0) };
    const decision = derive({ ...observed, counters: fullCounters });

    // ---- Deadline fence 2：derive 后 ----
    // wait/control 分支都在此 fence 之后，不能绕开硬上限。
    if (deadlineExceeded(observed.run)) {
      await markRunFailed(deps.pool, resolvedRunId, 'automation_deadline_exceeded');
      return { exitReason: 'automation_deadline_exceeded', hops };
    }

    if (dryRun) {
      log(`[orchestrator][dry-run] run=${resolvedRunId} phase=${decision.phase} action=${decision.action} reason=${decision.reason}`);
      return { exitReason: 'dry_run', hops, decision };
    }

    // ---- 控制 action 自消费（不派 dispatcher、不 append hop）----
    if (decision.action === ACTION.EXIT) {
      return { exitReason: decision.reason, hops };
    }
    if (decision.action === ACTION.MARK_FAILED) {
      await markRunFailed(deps.pool, resolvedRunId, decision.reason);
      return { exitReason: decision.reason, hops };
    }
    if (decision.action === ACTION.PERSIST_CONTRACT_APPROVAL) {
      if (!observed.contract.id) {
        if (!observed.proposeBranch || !Number.isInteger(observed.proposeBranchRn)
            || observed.proposeBranchRn < 1) {
          await markRunFailed(deps.pool, resolvedRunId, 'approved_but_no_contract_branch');
          return { exitReason: 'approved_but_no_contract_branch', hops };
        }
        const approvedSha = observed.ganLatestRoundContractSha ?? null;
        if (!approvedSha) {
          await markRunFailed(deps.pool, resolvedRunId, 'approved_but_no_contract_sha');
          return { exitReason: 'approved_but_no_contract_sha', hops };
        }
        const artifacts = frozenContractArtifacts(
          deps,
          observed,
          groundTruthPaths,
          approvedSha,
        );
        if (artifacts.missing.length > 0) {
          await markRunFailed(deps.pool, resolvedRunId, 'approved_but_contract_artifacts_missing');
          return { exitReason: 'approved_but_contract_artifacts_missing', hops };
        }
        await materializeApprovedContract(deps.pool, {
          runId: resolvedRunId,
          version: observed.proposeBranchRn,
          branch: observed.proposeBranch,
          prdContent: artifacts.prdContent,
          contractContent: artifacts.contractContent,
          approvedAt: now(),
        });
        await beat();
        continue;
      }
      // 崩溃窗口补落库（reviewer APPROVED 已出但 contract 未 approved），补完继续下一跳
      await deps.pool.query(
        `UPDATE initiative_contracts SET status = 'approved', approved_at = $2, updated_at = $2 WHERE id = $1`,
        [observed.contract.id, now()],
      );
      await beat();
      continue;
    }

    // ---- 纯轮询 wait：只心跳+sleep（部分需 append 持久化计数）、不派发 ----
    // wait:human_review 首次必须经过 dispatcher，才能真正创建预览并通知人；同一
    // PR SHA 已写过 intent 后才转为纯等待，避免每 90s 重复通知。
    if (decision.action === ACTION.WAIT_HUMAN_REVIEW) {
      const reviewAlreadyRequested = observed.decisionLog.some(
        (row) => row.action === LOG_ACTION.HUMAN_REVIEW_REQUESTED
          && row.observed?.pr?.head_sha === observed.pr?.head_sha,
      );
      if (reviewAlreadyRequested) {
        await beat();
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
    }
    if (decision.action === ACTION.WAIT_RUNNING) {
      await beat();
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (decision.action === ACTION.WAIT_POLL_CI) {
      // Sprint 07231527 Blocking 2：wait:poll_ci 必须写 decision log，持久化计数跨重启不归零
      // pollCount 从 deriveCounters 推导，appendHop 后重启恢复正确值
      const pollHop = await next(deps.pool, resolvedRunId);
      try {
        await append(deps.pool, {
          runId: resolvedRunId,
          hop: pollHop,
          observed: buildSnapshot(observed, fullCounters, ACTION.WAIT_POLL_CI),
          derivedPhase: decision.phase,
          gateVerdict: null,
          action: ACTION.WAIT_POLL_CI,
          detail: { reason: decision.reason, ci: observed.pr?.ci ?? 'pending' },
        });
        hops++;
      } catch (err) {
        if (err instanceof SingletonConflictError) {
          log(`[orchestrator] singleton conflict on poll_ci ${resolvedRunId} hop ${pollHop}, exiting`);
          return { exitReason: 'singleton_conflict', hops };
        }
        throw err;
      }
      await beat();
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // ---- 派发 action：intent-log-before-dispatch ----
    const hop = await next(deps.pool, resolvedRunId);
    const observedMaxHop = observed.decisionLog.reduce(
      (max, row) => Math.max(max, Number(row.hop) || 0),
      0,
    );
    // collectGroundTruth 在读 decision log 后还会做 gh/git/docker IO。外部
    // callback 可能在这段窗口追加 verdict，使当前 decision 已经过期。nextHop
    // 看到的数据库版本若领先于 observed 快照，就必须丢弃快照重新观测；否则
    // 会在 PASS 已落库后重复 spawn 同一角色。hop=0 的初始兼容路径继续交给
    // appendHop UNIQUE(run_id,hop) 做最终并发栅栏。
    if (observedMaxHop > 0 && hop !== observedMaxHop + 1) {
      log(
        `[orchestrator] stale observation on run ${resolvedRunId}: ` +
        `observed max hop ${observedMaxHop}, database next hop ${hop}; re-observing`,
      );
      await beat();
      continue;
    }
    let gateVerdict = null;
    if (decision.action === ACTION.MERGE_PR) {
      // F6 双保险：derive 说 merge，仍过一遍 mergeGate（唯一 merge 权威）
      const gate = mergeGate({
        evaluateVerdict: observed.evaluateVerdict,
        judgeVerdict: observed.judgeVerdict,
        prHeadSha: observed.pr.head_sha,
        reviewRequired: observed.reviewRequired,
        reviewApproved: observed.reviewApproved,
      });
      gateVerdict = gate.allow ? 'allow' : `deny:${gate.reason}`;
    }

    try {
      await append(deps.pool, {
        runId: resolvedRunId,
        hop,
        observed: buildSnapshot(observed, fullCounters, decision.action),
        derivedPhase: decision.phase,
        gateVerdict,
        action: decision.action,
        detail: { reason: decision.reason, crossCheckMismatch: counters.crossCheckMismatch },
      });
    } catch (err) {
      if (err instanceof SingletonConflictError) {
        // UNIQUE(run_id,hop) 冲突 = 并发 orchestrator 实例 → 本进程立即让位，交 watchdog
        log(`[orchestrator] singleton conflict on run ${resolvedRunId} hop ${hop}, exiting`);
        return { exitReason: 'singleton_conflict', hops };
      }
      throw err;
    }
    hops++;

    // ---- Deadline fence 3：dispatch 前 ----
    // intent 持久化与真实副作用之间仍可能跨过 deadline；此时保留审计 intent，但不派发。
    if (deadlineExceeded(observed.run)) {
      await markRunFailed(deps.pool, resolvedRunId, 'automation_deadline_exceeded');
      return { exitReason: 'automation_deadline_exceeded', hops };
    }

    // gateVerdict deny（derive 与 mergeGate 意见不一致 = 观测竞态）→ 不派发，按 BLOCKED 同态处理
    const result = gateVerdict?.startsWith('deny:')
      ? { status: 'BLOCKED', detail: gateVerdict }
      : await deps.dispatch(decision.action, { taskId, runId: resolvedRunId, hop, observed, decision });

    // Intent 只能证明“准备通知”，不能证明 preview/通知副作用成功。成功后追加独立
    // effect marker；若首次派发失败，下一轮看不到 marker，仍会重试而不是永久空等。
    if (decision.action === ACTION.WAIT_HUMAN_REVIEW
        && (result.status === 'DONE' || result.status === 'DONE_WITH_CONCERNS')) {
      const effectHop = await next(deps.pool, resolvedRunId);
      await append(deps.pool, {
        runId: resolvedRunId,
        hop: effectHop,
        observed: buildSnapshot(observed, fullCounters, LOG_ACTION.HUMAN_REVIEW_REQUESTED),
        derivedPhase: decision.phase,
        gateVerdict: null,
        action: LOG_ACTION.HUMAN_REVIEW_REQUESTED,
        detail: { dispatch_hop: hop, result: result.detail ?? null },
      });
      hops++;
    }

    if (result.status === 'NEEDS_CONTEXT' || result.status === 'BLOCKED') {
      // blockedStreak 从 DB 推导（Sprint 07231527 Blocking 2，counters.blockedStreak 已含此跳）
      const currentBlockedStreak = counters.blockedStreak ?? 0;
      if (blockedState === result.status) {
        // 同态继续累积；counters.blockedStreak 是 DB 推导值（含本跳前的值），本跳 +1 在下轮 derive 后
      } else {
        blockedState = result.status;
      }
      const streak = currentBlockedStreak + 1; // 本轮实际 streak
      log(`[orchestrator] hop ${hop} ${decision.action} → ${result.status} (streak ${streak}): ${result.detail ?? ''}`);
      if (streak >= BLOCKED_SAME_STATE_CAP) {
        await markRunFailed(deps.pool, resolvedRunId, `blocked_same_state:${result.status}`);
        return { exitReason: 'blocked_same_state', hops };
      }
    } else {
      // DONE / DONE_WITH_CONCERNS：记 detail 继续
      blockedState = null;
      log(`[orchestrator] hop ${hop} ${decision.action} → ${result.status}${result.detail ? `: ${result.detail}` : ''}`);
    }

    // ---- Deadline fence 3：DONE 心跳后检查（崩溃窗口补丁）----
    // INV-K1：三道 fence，防止在 deadline 后派遣下一轮 intent（即使 dispatch 已返回 DONE）
    if (deadlineExceeded(observed.run)) {
      await markRunFailed(deps.pool, resolvedRunId, 'automation_deadline_exceeded');
      return { exitReason: 'automation_deadline_exceeded', hops };
    }

    await beat();
  }
}
