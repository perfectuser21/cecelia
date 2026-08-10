const LOCK_PREFIX = 'fact-snapshot';

export async function acquireFactSnapshotLock(client, namespace, repo) {
  const lockKey = `${LOCK_PREFIX}:${namespace}:${repo}`;
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1::text))',
    [lockKey],
  );
}
