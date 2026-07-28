const LOCK_SQL = `
  SELECT pg_try_advisory_lock(
    hashtextextended('kernel-release/production-mutation/v1', 0)
  ) AS acquired`;

const UNLOCK_SQL = `
  SELECT pg_advisory_unlock(
    hashtextextended('kernel-release/production-mutation/v1', 0)
  ) AS released`;

function lockError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function acquireProductionMutationLock(pool, {
  onWait = async () => {},
  retryIntervalMs = 250,
  timeoutMs = 15 * 60_000,
} = {}) {
  if (typeof pool?.connect !== 'function') {
    throw lockError('release_production_mutation_lock_invalid');
  }
  const client = await pool.connect();
  const abortController = new AbortController();
  const abort = (error) => abortController.abort(
    error instanceof Error ? error : lockError('release_production_mutation_lock_lost'),
  );
  client.on?.('error', abort);
  client.on?.('end', abort);
  let acquired = false;
  try {
    const deadline = Date.now() + timeoutMs;
    do {
      const { rows } = await client.query(LOCK_SQL);
      acquired = rows?.[0]?.acquired === true;
      if (acquired) break;
      await onWait(client);
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    } while (!abortController.signal.aborted);
    if (!acquired) {
      throw abortController.signal.reason
        ?? lockError('release_production_mutation_busy');
    }
  } catch (error) {
    client.off?.('error', abort);
    client.off?.('end', abort);
    client.release();
    throw error;
  }
  let released = false;
  return Object.freeze({
    client,
    signal: abortController.signal,
    async release() {
      if (released) return;
      released = true;
      try {
        await client.query(UNLOCK_SQL);
      } finally {
        client.off?.('error', abort);
        client.off?.('end', abort);
        client.release();
      }
    },
  });
}

export const __test__ = { LOCK_SQL, UNLOCK_SQL };
