const retained = (reason) => ({ status: 'retained', reason });

function ownedIdleJob(jobs, context) {
  if (!Array.isArray(jobs)) return null;
  const matches = jobs.filter(job => job.name === `escort-${context.host}-${context.tag}`);
  if (matches.length !== 1 || matches[0].id !== context.escortId
    || matches[0].schedule?.kind !== 'every') return null;
  const job = matches[0];
  if (!job.state || typeof job.state !== 'object') return null;
  const running = job.state.runningAtMs;
  if (running != null && (typeof running !== 'number' || !Number.isFinite(running))) return null;
  return { job, idle: running == null };
}

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
  let requested = false;
  let cancellationRetries = 0;
  async function retryCancelledTick(owned, receipt) {
    if (!owned.idle || owned.job.enabled !== false
      || owned.job.state.lastRunStatus !== 'error'
      || owned.job.state.lastError !== 'Cron job disabled by operator.'
      || !validReceipt(receipt, context) || typeof deps.resumeJob !== 'function'
      || cancellationRetries >= 2) return false;
    cancellationRetries++;
    await deps.resumeJob(context.escortId);
    const resumed = ownedIdleJob(await deps.readJobs(), context);
    if (!resumed || resumed.job.enabled !== true) return false;
    // 恢复的是同一个终态售后tick，仍须自然成功退出；不把取消当成功。
    requested = true;
    if (resumed.idle) await deps.requestTick(context.escortId);
    return true;
  }
  try {
    polling: while (deps.now() - started < deps.timeoutMs) {
      const owned = ownedIdleJob(await deps.readJobs(), context);
      if (!owned) return retained('ambiguous-or-unreadable-job');
      const receipt = await deps.readReceipt();
      if (owned.idle && owned.job.enabled === false && owned.job.state.lastRunStatus !== 'ok') {
        if (await retryCancelledTick(owned, receipt)) continue;
        return retained('last-tick-not-successful');
      }
      if (owned.idle && owned.job.state.lastRunStatus === 'ok' && validReceipt(receipt, context)
        && receiptInFinishedTick(receipt, owned.job)) {
        await deps.recordAftercare(receipt);
        // 禁用行为取决于运输实现；可能取消刚抢跑的tick，后续必须读回ok，否则保留。
        await deps.quiesceJob(context.escortId);
        while (deps.now() - started < deps.timeoutMs) {
          const checked = ownedIdleJob(await deps.readJobs(), context);
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
              await deps.recordAftercare(finalReceipt);
              const confirmed = ownedIdleJob(await deps.readJobs(), context);
              if (!confirmed || !confirmed.idle || confirmed.job.enabled !== false
                || confirmed.job.state.lastRunStatus !== 'ok'
                || !receiptInFinishedTick(finalReceipt, confirmed.job)) return retained('aftercare-tick-mismatch');
            }
            await deps.removeJob(context.escortId);
            return { status: 'retired', receipt: finalReceipt };
          }
          await deps.sleep(deps.pollMs);
        }
        return retained('disabled-tick-still-running');
      }
      if (owned.idle && !requested) {
        requested = true;
        await deps.requestTick(context.escortId);
        continue;
      }
      await deps.sleep(deps.pollMs);
    }
    return retained('aftercare-timeout');
  } catch (error) {
    return retained(`dependency-failed: ${error.message}`);
  }
}
