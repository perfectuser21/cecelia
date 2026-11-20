/** 退役OpenClaw运行的只读探测与结果收尾；不再提供任何新启动入口。 */
import { isCommanderVerification, verificationTaskSql, verificationRuntime } from './lib/commander-verification-transport.js';
import { execFile as nodeExecFile } from 'node:child_process';
import { SSH_BASE_ARGS } from './lib/ssh-args.js';
import { resolvePrimaryWorkerId, sshTargetFor } from './machine-registry.js';
import { sshRun } from './lib/ssh-exec.js';
import { recordTaskEventSafe } from './lib/task-event-log.js';
import { finishRun } from './lib/task-run.js';
import { finalizeTask } from './lib/task-terminal.js';
import { rpaExploreFailure } from './lib/rpa-explore-receipt.js';
import { consumeCompanyAnalysis, markCompanyAnalysis } from './lib/company-kr-analysis.js';
import { parseDeviceBusyMarker, planDeviceBusy, requeueForDeviceBusy, DEVICE_BUSY_EXPIRED_REASON, DUE_AT_SELECT_SQL } from './lib/qiumi-device-busy.js';
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const REAP_SSH_TIMEOUT_MS = 15000;
const REAP_BATCH = 10;
export function isSafeRunId(runId) {
  const v = String(runId);
  return SAFE_ID.test(v) && !v.includes('..');
}
function primaryTarget() {
  return sshTargetFor(resolvePrimaryWorkerId());
}
export function parseReceipt(exit, tail) {
  let text = null;
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // 这行不是完整 JSON（正文带括号、或被 tail -c 切断），继续往上找
    }
    text = parsed.finalAssistantVisibleText ?? parsed?.result?.payloads?.[0]?.text ?? null;
    break;
  }
  // 真实 --json 输出是多行缩进 JSON，且尾巴常从对象中间截断，上面逐行解析取不到：
  // 直接按字段名取最后一个 finalAssistantVisibleText 的字符串值（JSON 字符串转义照常解码）。
  if (text == null) {
    const all = [...tail.matchAll(/"finalAssistantVisibleText":\s*"((?:[^"\\]|\\.)*)"/g)];
    if (all.length) {
      try { text = JSON.parse(`"${all[all.length - 1][1]}"`); } catch { text = null; }
    }
  }
  if (text == null) {
    // OpenClaw当前CLI也输出多行result.payloads；从行首对象尝试完整包装。
    const starts = [...tail.matchAll(/^[ \t]*\{/gm)].map(m => m.index).slice(-100);
    for (const start of starts) {
      try {
        const parsed = JSON.parse(tail.slice(start).trim());
        const visible = parsed.finalAssistantVisibleText ?? parsed?.result?.payloads?.[0]?.text;
        if (typeof visible === 'string') { text = visible; break; }
      } catch { /* 非完整CLI包装，继续寻找。 */ }
    }
  }
  return { exit, text, log_tail: tail.slice(-2000), reaped_at: new Date().toISOString() };
}

/**
 * agent 以 sessions_yield 收尾、没有交最终结果（任务 e3c81cce）。55c2e84b 真实 .log：开头
 * `result.payloads: []`，尾部 `meta.yielded: true` + `acceptedSessionSpawns[]`；收割只读 tail -c 20000，
 * 30KB 的日志开头读不到，所以两类信号任一命中即算：
 *  · `"yielded": true` —— 本会话暂停等子会话，活在追踪外，有没有过渡文本都不算完成；
 *  · 没有最终文本且 `"payloads": []` —— 什么都没交。
 * 仅「无最终文本」不单独判失败：旧格式纯文本日志也取不到 text，那不是 yield。
 */
function yieldSummaryOf(tail, text) {
  const yielded = /"yielded"\s*:\s*true/.test(tail);
  const emptyPayloads = text == null && /"payloads"\s*:\s*\[\s*\]/.test(tail);
  if (!yielded && !emptyPayloads) return null;
  const childSessions = [...tail.matchAll(/"childSessionKey"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
  return { yielded, empty_payloads: emptyPayloads, has_text: text != null, child_sessions: childSessions };
}

/** 回执 → 终态：退出码非 0 → exit_<n>；exit 0 但以 yield 收尾 → agent_yielded_without_result；否则完成。 */
function reapOutcome(receipt, tail) {
  if (receipt.exit !== 0) return { status: 'failed', reason: `openclaw_agent_exit_${receipt.exit}`, yieldSummary: null };
  const yieldSummary = yieldSummaryOf(tail, receipt.text);
  if (yieldSummary) return { status: 'failed', reason: 'agent_yielded_without_result', yieldSummary };
  return { status: 'completed_no_pr', reason: null, yieldSummary: null };
}

/**
 * agent 回报手机忙（最终文本含 DEVICE_BUSY 标记行，任务 5ad81457）→ 不判终态，回队等 5 分钟再派；
 * 到截止时间（expires_at → due_at → 首次忙起 24 小时）仍忙 → failed(device_busy_expired)。
 * 历史执行超时与排队等待分开，保留旧DEVICE_BUSY收尾合同。
 * @returns {Promise<'requeued'|'failed'|null>} null = 不是手机忙，走常规收割
 */
async function settleDeviceBusy(pool, row, receipt, now) {
  const marker = parseDeviceBusyMarker(receipt.text);
  if (!marker) return null;
  const payload = row.payload ?? {};
  const plan = planDeviceBusy({ payload, marker, dueAt: row.due_at ?? null, now });
  if (plan.action === 'requeue') {
    const requeued = await requeueForDeviceBusy(pool, row.id, plan, row.run_id);
    await finishRun({ runId: row.run_id, status: 'cancelled', exitCode: receipt.exit, error: 'device_busy' }, { pool });
    await recordTaskEventSafe(pool, row.id, 'qiumi_device_busy_requeued', {
      run_id: row.run_id, owner: plan.deviceBusy.owner, serial: plan.deviceBusy.serial,
      attempt: plan.attempts, next_run_at: plan.nextRunAt, waited_ms: plan.waitedMs,
      deadline_at: plan.deadlineAt, deadline_source: plan.deadlineSource, applied: requeued,
    });
    return 'requeued';
  }
  await finalizeTask(pool, row.id, 'failed', {
    set: { error_message: DEVICE_BUSY_EXPIRED_REASON },
    mergeResult: { receipt, device_busy: plan.deviceBusy },
    onlyIfStatus: 'in_progress',
  });
  await finishRun({ runId: row.run_id, status: 'failed', exitCode: receipt.exit, error: DEVICE_BUSY_EXPIRED_REASON }, { pool });
  await recordTaskEventSafe(pool, row.id, 'openclaw_agent_reaped', {
    run_id: row.run_id, exit: receipt.exit, reason: DEVICE_BUSY_EXPIRED_REASON,
    owner: plan.deviceBusy.owner, attempt: plan.attempts, waited_ms: plan.waitedMs,
    deadline_at: plan.deadlineAt, deadline_source: plan.deadlineSource,
  });
  return 'failed';
}

/**
 * 收割在跑的 openclaw-agent 任务：远端 .exit 落地即结算。
 *
 * 三态：EXIT=0 → completed_no_pr + receipt（以 yield 收尾的除外 → failed + agent_yielded_without_result，
 * 不自动重排：子会话可能已在真机上动手，重跑会把真机操作做两遍）；EXIT≠0 → failed + openclaw_agent_exit_<n>；
 * NO_EXIT → 一律不动（还在跑），超时交给合同 staleMinutes=45 + 守护刀 onStale='fail'。
 * 例外：最终文本含 DEVICE_BUSY 标记行（手机锁被占）→ 先于三态处理，回队等待（settleDeviceBusy）。
 * 两条 UPDATE 都带 `AND status = 'in_progress'` 的 CAS：不覆盖别的通道已经结过的账。
 *
 */
export async function reapOpenclawAgentRuns(pool, deps = {}) {
  const execFileFn = deps.execFileFn ?? nodeExecFile;
  const now = deps.now ?? Date.now;
  const { rows } = await pool.query(
    `SELECT id, task_type, payload->>'run_id' AS run_id, payload, ${DUE_AT_SELECT_SQL} AS due_at FROM tasks
      WHERE (task_type = 'qiumi_task' OR ${verificationTaskSql()}) AND status = 'in_progress' AND executor_kind = 'openclaw-agent'
        AND payload->>'run_id' IS NOT NULL
      ORDER BY started_at ASC NULLS FIRST
      LIMIT ${REAP_BATCH}`,
  );
  const out = { reaped: 0, completed: 0, failed: 0, requeued: 0 };
  for (const r of rows ?? []) {
    const companyAnalysis = r.payload?.company_kr_analysis?.version === 1;
    if (!isSafeRunId(r.run_id)) {
      console.warn(`[openclaw-agent] 收割跳过非法 run_id: ${String(r.run_id).slice(0, 60)}`);
      continue;
    }
    let stdout;
    try {
      stdout = await sshRun(execFileFn, [
        ...SSH_BASE_ARGS, primaryTarget(),
        `if [ -f ~/brain-runs/${r.run_id}.exit ]; then echo EXIT=$(cat ~/brain-runs/${r.run_id}.exit); tail -c ${isCommanderVerification(r) ? 200000 : companyAnalysis ? 160000 : 20000} ~/brain-runs/${r.run_id}.log 2>/dev/null; else echo NO_EXIT; fi`,
      ], { timeout: REAP_SSH_TIMEOUT_MS, encoding: 'utf8' });
    } catch (err) {
      console.warn(`[openclaw-agent] 收割 ${r.run_id} 探测失败: ${err.message}`);
      continue;
    }
    const m = stdout.match(/^EXIT=(\d+)/m);
    if (!m) continue;
    const exit = parseInt(m[1], 10);
    const tail = stdout.replace(/^EXIT=\d+\n?/m, '');
    const receipt = parseReceipt(exit, tail);
    const busy = isCommanderVerification(r) ? null : await settleDeviceBusy(pool, r, receipt, now());
    if (busy === 'requeued') { out.requeued++; continue; }
    if (busy === 'failed') { out.failed++; out.reaped++; continue; }
    let outcome = reapOutcome(receipt, tail);
    if (outcome.status === 'completed_no_pr' && !isCommanderVerification(r)) {
      const reason = rpaExploreFailure(r, receipt);
      if (reason) outcome = { status: 'failed', reason, yieldSummary: null };
    }
    if (isCommanderVerification(r)) {
      try { receipt.verification_runtime = verificationRuntime(tail, r.run_id); }
      catch (error) { outcome = { status: 'failed', reason: error.message, yieldSummary: null }; }
    }
    let analysis = null;
    if (companyAnalysis && outcome.status === 'completed_no_pr') {
      try { analysis = await (deps.consumeCompanyAnalysis || consumeCompanyAnalysis)(pool, r, receipt); }
      catch (error) { outcome = { status: 'failed', reason: `company_kr_analysis_rejected: ${error.message}`, yieldSummary: null }; }
    }
    if (companyAnalysis && outcome.status === 'failed') await (deps.markCompanyAnalysis || markCompanyAnalysis)(pool, r, 'failed', outcome.reason);
    if (outcome.status === 'completed_no_pr') {
      // completed_no_pr 是可接棒终态（RELAY_TERMINAL_STATUSES）：finalizeTask 写完自动接棒
      await finalizeTask(pool, r.id, 'completed_no_pr', { mergeResult: { receipt, ...(analysis ? { company_kr_analysis: analysis } : {}) }, onlyIfStatus: 'in_progress' });
      out.completed++;
    } else {
      const mergeResult = outcome.yieldSummary ? { receipt, yield_summary: outcome.yieldSummary } : { receipt };
      await finalizeTask(pool, r.id, 'failed', {
        set: { error_message: outcome.reason },
        mergeResult,
        onlyIfStatus: 'in_progress',
      });
      out.failed++;
    }
    out.reaped++;
    // run 原语补终态：exit≠0 或以 yield 收尾 → failed，其余 → completed，已终态不覆盖。
    await finishRun({
      runId: r.run_id,
      status: outcome.status === 'completed_no_pr' ? 'completed' : 'failed',
      exitCode: exit,
      error: outcome.reason ?? undefined,
    }, { pool });
    await recordTaskEventSafe(pool, r.id, 'openclaw_agent_reaped', {
      run_id: r.run_id, exit, ...(outcome.reason ? { reason: outcome.reason } : {}),
    });
  }
  return out;
}
