import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
const retained = (reason) => ({ status: 'retained', reason });
const ownerKeys = new Set(['escortId', 'generation', 'operationId', 'nonce']);
const immutableContext = c => Object.fromEntries(Object.entries(c).filter(([key]) => !ownerKeys.has(key)));
const sameOwner = (a, b) => ['escortId', 'generation', 'operationId'].every(key => a[key] === b[key]);

function ownedIdleJob(jobs, context, strictRole = false) {
  if (!Array.isArray(jobs)) return null;
  const matches = jobs.filter(job => job.name === `escort-${context.host}-${context.tag}`);
  if (matches.length !== 1 || matches[0].id !== context.escortId
    || matches[0].schedule?.kind !== 'every') return null;
  const job = matches[0];
  if (strictRole && (job.agentId !== 'work-commander'
    || job.sessionTarget !== `session:escort-${context.host}-${context.tag}`
    || job.schedule.everyMs !== 600000)) return null;
  if (!job.state || typeof job.state !== 'object') return null;
  const running = job.state.runningAtMs;
  if (running != null && (typeof running !== 'number' || !Number.isFinite(running))) return null;
  return { job, idle: running == null };
}

export const inspectAftercareRole = (jobs, context) => ownedIdleJob(jobs, context, true);

function validReceipt(receipt, context) {
  return receipt?.schema_version === 1 && receipt.run_tag === context.tag
    && receipt.host === context.host && receipt.escort_id === context.escortId
    && receipt.nonce === context.nonce && receipt.finalize_verified === true
    && receipt.status === 'completed' && typeof receipt.actor === 'string' && receipt.actor.trim()
    && ['facts', 'evidence'].every(key => Array.isArray(receipt[key])
      && receipt[key].length > 0 && receipt[key].every(value => typeof value === 'string' && value.trim()));
}

function receiptInFinishedTick(receipt, job) {
  const { lastRunAtMs: start, lastDurationMs: duration } = job.state;
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(duration)
    || duration < 0 || !Number.isSafeInteger(start + duration)
    || typeof receipt?.at !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(receipt.at)) return false;
  const at = Date.parse(receipt.at);
  return Number.isFinite(at) && at >= start && at <= start + duration;
}

/** 售后证据、Brain 留痕、同 ID 的空闲 tick 三项齐备才注销。 */
export async function finishEscortAftercare(context, deps) {
  if (context?.finalized !== true || !['tag', 'host', 'escortId', 'nonce'].every(key =>
    typeof context[key] === 'string' && /^[a-zA-Z0-9_-]+$/.test(context[key]))) {
    return retained('invalid-finalize-context');
  }
  const started = deps.now();
  context = structuredClone(context);
  const hasAuthority = deps.refreshContext !== undefined || deps.withGenerationFence !== undefined;
  if (hasAuthority && (typeof deps.refreshContext !== 'function' || typeof deps.withGenerationFence !== 'function')) {
    return retained('incomplete-generation-authority');
  }
  if (hasAuthority && (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(context.taskId || '')
    || (context.generation !== undefined) !== (context.operationId !== undefined)
    || context.generation !== undefined && (!Number.isSafeInteger(context.generation) || context.generation < 1
      || typeof context.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(context.operationId)))) return retained('invalid-generation-context');
  const initial = immutableContext(context);
  const wallNow = typeof deps.wallNow === 'function' ? deps.wallNow : hasAuthority ? Date.now : null;
  const requestedAt = Date.parse(context.requestedAt);
  const deadline = requestedAt + 20 * 60 * 1000;
  if (wallNow && (!Number.isFinite(requestedAt) || requestedAt > wallNow()
    || typeof context.requestedAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(context.requestedAt)
    || context.deadlineAt !== undefined && Date.parse(context.deadlineAt) !== deadline)) return retained('invalid-aftercare-deadline');
  const retryCount = deps.cancellationRetries ?? context.cancellationRetries ?? 0;
  if (!Number.isSafeInteger(retryCount) || retryCount < 0 || retryCount > 2) return retained('invalid-cancellation-budget');
  const withinDeadline = () => deps.now() - started < deps.timeoutMs
    && (!wallNow || wallNow() < deadline);
  async function authority() {
    const a = await deps.refreshContext(structuredClone(context));
    if (a?.state !== 'committed' || !a.context || !isDeepStrictEqual(immutableContext(a.context), initial)
      || !Number.isSafeInteger(a.generation) || a.generation < 1
      || typeof a.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(a.operationId)
      || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(a.context.escortId || '')) throw Error('generation-authority-unconfirmed');
    const next = { ...context, escortId: a.context.escortId, generation: a.generation, operationId: a.operationId };
    if (context.generation !== undefined && (!sameOwner(context, next)
      && (next.generation <= context.generation || next.escortId === context.escortId))) throw Error('generation-authority-regression');
    return next;
  }
  async function runFence(token, action) {
    let called = false, completed = false, open = true, value;
    try {
      await deps.withGenerationFence(token, async () => {
        if (!open || called) throw Error('invalid-generation-fence-callback');
        called = true; value = await action(); completed = true; return value;
      });
    } finally { open = false; }
    if (!called || !completed) throw Error('generation-fence-not-executed');
    return value;
  }
  async function fenced(operation, action) {
    if (!withinDeadline()) throw Error('aftercare-timeout');
    if (!hasAuthority) return action();
    const current = await authority();
    if (!sameOwner(current, context)) throw Error('generation-stale');
    return runFence({ context: structuredClone(context), generation: context.generation,
      operationId: context.operationId, operation }, async () => {
      if (!withinDeadline()) throw Error('aftercare-timeout');
      return action();
    });
  }
  async function refresh() {
    if (!hasAuthority) return;
    const next = await authority();
    if (sameOwner(next, context)) return;
    if (typeof deps.persistContext !== 'function') throw Error('generation-persistence-missing');
    const previous = context;
    context = await runFence({ context: next, generation: next.generation,
      operationId: next.operationId, operation: 'persistContext' }, async () => {
      if (!withinDeadline()) throw Error('aftercare-timeout');
      if (!ownedIdleJob(await deps.readJobs(), next, true)) throw Error('generation-candidate-role-unconfirmed');
      if (!withinDeadline()) throw Error('aftercare-timeout');
      const proposed = { ...next, nonce: next.escortId === previous.escortId ? previous.nonce : randomUUID() };
      const saved = await deps.persistContext(proposed, previous) || proposed;
      if (!sameOwner(saved, proposed) || !isDeepStrictEqual(immutableContext(saved), initial)
        || typeof saved.nonce !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(saved.nonce)
        || saved.escortId !== previous.escortId && saved.nonce === previous.nonce) throw Error('generation-persistence-mismatch');
      return saved;
    });
    requested = false;
  }
  async function mutate(operation, action, verify) {
    return fenced(operation, async () => {
      if (hasAuthority && !ownedIdleJob(await deps.readJobs(), context, hasAuthority)) throw Error('generation-job-readback-mismatch');
      if (!withinDeadline()) throw Error('aftercare-timeout');
      await action(); return verify ? verify() : undefined;
    });
  }
  let requested = false;
  let cancellationRetries = retryCount;
  async function retryCancelledTick(owned, receipt) {
    if (!owned.idle || owned.job.enabled !== false
      || owned.job.state.lastRunStatus !== 'error'
      || owned.job.state.lastError !== 'Cron job disabled by operator.'
      || !validReceipt(receipt, context) || typeof deps.resumeJob !== 'function'
      || cancellationRetries >= 2) return false;
    const resumed = await mutate('resumeJob', async () => {
      cancellationRetries++;
      if (typeof deps.persistRetry === 'function') await deps.persistRetry(context, cancellationRetries);
      if (!withinDeadline()) throw Error('aftercare-timeout');
      await deps.resumeJob(context.escortId);
    }, async () => ownedIdleJob(await deps.readJobs(), context, hasAuthority));
    if (!resumed || resumed.job.enabled !== true) return false;
    // 恢复的是同一个终态售后tick，仍须自然成功退出；不把取消当成功。
    requested = true;
    if (resumed.idle) await mutate('requestTick', () => deps.requestTick(context.escortId), async () => {
      if (!ownedIdleJob(await deps.readJobs(), context, hasAuthority)) throw Error('generation-job-readback-mismatch');
    });
    return true;
  }
  try {
    polling: while (withinDeadline()) {
      await refresh();
      const owned = ownedIdleJob(await deps.readJobs(), context, hasAuthority);
      if (!owned) return retained('ambiguous-or-unreadable-job');
      const receipt = await deps.readReceipt();
      if (owned.idle && owned.job.enabled === false && owned.job.state.lastRunStatus !== 'ok') {
        if (await retryCancelledTick(owned, receipt)) continue;
        return retained('last-tick-not-successful');
      }
      if (owned.idle && owned.job.state.lastRunStatus === 'ok' && validReceipt(receipt, context)
        && receiptInFinishedTick(receipt, owned.job)) {
        await mutate('recordAftercare', () => deps.recordAftercare(receipt), async () => {
          if (hasAuthority && !ownedIdleJob(await deps.readJobs(), context, hasAuthority)) throw Error('generation-job-readback-mismatch');
        });
        // 禁用行为取决于运输实现；可能取消刚抢跑的tick，后续必须读回ok，否则保留。
        await mutate('quiesceJob', () => deps.quiesceJob(context.escortId), async () => {
          if (hasAuthority && !ownedIdleJob(await deps.readJobs(), context, hasAuthority)) throw Error('generation-job-readback-mismatch');
        });
        while (withinDeadline()) {
          const checked = ownedIdleJob(await deps.readJobs(), context, hasAuthority);
          if (!checked || checked.job.enabled !== false) return retained('quiescence-unconfirmed');
          if (checked.idle) {
            if (checked.job.state.lastRunStatus !== 'ok') {
              if (await retryCancelledTick(checked, await deps.readReceipt())) continue polling;
              return retained('last-tick-not-successful');
            }
            const finalReceipt = await deps.readReceipt();
            if (!validReceipt(finalReceipt, context) || !receiptInFinishedTick(finalReceipt, checked.job)) {
              return retained('aftercare-tick-mismatch');
            }
            if (JSON.stringify(finalReceipt) !== JSON.stringify(receipt)) {
              await mutate('recordAftercare', () => deps.recordAftercare(finalReceipt), async () => {
                const confirmed = ownedIdleJob(await deps.readJobs(), context, hasAuthority);
                if (!confirmed || !confirmed.idle || confirmed.job.enabled !== false
                  || confirmed.job.state.lastRunStatus !== 'ok'
                  || !receiptInFinishedTick(finalReceipt, confirmed.job)) throw Error('aftercare-tick-mismatch');
              });
            }
            await mutate('removeJob', async () => {
              if (hasAuthority) {
                const job = ownedIdleJob(await deps.readJobs(), context, hasAuthority), ack = await deps.readReceipt();
                if (!job?.idle || job.job.enabled !== false || job.job.state.lastRunStatus !== 'ok'
                  || !validReceipt(ack, context) || !receiptInFinishedTick(ack, job.job)
                  || !isDeepStrictEqual(ack, finalReceipt)) throw Error('aftercare-tick-mismatch');
              }
              if (!withinDeadline()) throw Error('aftercare-timeout');
              await deps.removeJob(context.escortId);
            }, async () => {
              if (hasAuthority) {
                const jobs = await deps.readJobs();
                if (!Array.isArray(jobs) || jobs.some(job => job.id === context.escortId
                  || job.name === `escort-${context.host}-${context.tag}`)) throw Error('cron-removal-unconfirmed');
              }
            });
            return { status: 'retired', receipt: finalReceipt };
          }
          await deps.sleep(deps.pollMs);
        }
        return retained('disabled-tick-still-running');
      }
      if (owned.idle && !requested) {
        requested = true;
        await mutate('requestTick', () => deps.requestTick(context.escortId), async () => {
          if (hasAuthority && !ownedIdleJob(await deps.readJobs(), context, hasAuthority)) throw Error('generation-job-readback-mismatch');
        });
        continue;
      }
      await deps.sleep(deps.pollMs);
    }
    return retained('aftercare-timeout');
  } catch (error) {
    return retained(`dependency-failed: ${error.message}`);
  }
}
