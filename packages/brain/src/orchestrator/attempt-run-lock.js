/**
 * Serialize projected attempt mutations under the canonical run -> attempt
 * lock order. Migration 367 projects lifecycle events that reference the run,
 * so taking an attempt row first can deadlock terminal run cleanup.
 */
export function createAttemptRunLock(pool, {
  transactionClient = false,
  queryOnlyTestAdapter = false,
} = {}) {
  const isPool = typeof pool?.connect === 'function'
    && typeof pool?.release !== 'function';
  if (queryOnlyTestAdapter && process.env.NODE_ENV !== 'test') {
    throw new Error('queryOnlyTestAdapter is restricted to tests');
  }

  return async function mutateAttemptAfterRunLock(attemptId, mutate) {
    if (queryOnlyTestAdapter) return mutate(pool);
    if (!isPool && !transactionClient) {
      throw new Error(
        'attempt mutation requires a PostgreSQL Pool or transactionClient',
      );
    }

    const client = isPool ? await pool.connect() : pool;
    const ownsTransaction = isPool && !transactionClient;
    try {
      if (ownsTransaction) await client.query('BEGIN');
      await client.query(
        `SELECT run.id
           FROM harness_attempts attempt
           JOIN initiative_runs run ON run.id = attempt.run_id
          WHERE attempt.id = $1
          FOR SHARE OF run`,
        [attemptId],
      );
      const result = await mutate(client);
      if (ownsTransaction) await client.query('COMMIT');
      return result;
    } catch (error) {
      if (ownsTransaction) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      if (isPool) client.release();
    }
  };
}
