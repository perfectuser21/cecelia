export async function cleanupRoutedTasks(pool, taskIds) {
  if (!Array.isArray(taskIds) || taskIds.length === 0) return;
  const client = await pool.connect();
  try {
    const database = await client.query('SELECT current_database() AS name');
    if (!/(?:_test|_scratch)$/.test(database.rows[0]?.name ?? '')) {
      throw new Error('routed task cleanup is restricted to test or scratch databases');
    }
    await client.query("SET session_replication_role = 'replica'");
    await client.query('DELETE FROM work_routing_receipts WHERE task_id = ANY($1)', [taskIds]);
    await client.query('DELETE FROM tasks WHERE id = ANY($1)', [taskIds]);
  } finally {
    await client.query("SET session_replication_role = 'origin'");
    client.release();
  }
}
