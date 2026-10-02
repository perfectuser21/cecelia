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

/** 售后证据、Brain 留痕、同 ID 的空闲 tick 三项齐备才注销。 */
export async function finishEscortAftercare(context, deps) {
  if (context?.finalized !== true || !['tag', 'host', 'escortId', 'nonce'].every(key =>
    typeof context[key] === 'string' && /^[a-zA-Z0-9_-]+$/.test(context[key]))) {
    return retained('invalid-finalize-context');
  }
  const started = deps.now();
  let requested = false;
  try {
    while (deps.now() - started < deps.timeoutMs) {
      const owned = ownedIdleJob(await deps.readJobs(), context);
      if (!owned) return retained('ambiguous-or-unreadable-job');
      const receipt = await deps.readReceipt();
      if (owned.idle && owned.job.state.lastRunStatus === 'ok' && validReceipt(receipt, context)) {
        await deps.recordAftercare(receipt);
        // 禁用行为取决于运输实现；可能取消刚抢跑的tick，后续必须读回ok，否则保留。
        await deps.quiesceJob(context.escortId);
        while (deps.now() - started < deps.timeoutMs) {
          const checked = ownedIdleJob(await deps.readJobs(), context);
          if (!checked || checked.job.enabled !== false) return retained('quiescence-unconfirmed');
          if (checked.idle) {
            if (checked.job.state.lastRunStatus !== 'ok') return retained('last-tick-not-successful');
            await deps.removeJob(context.escortId);
            return { status: 'retired', receipt };
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
