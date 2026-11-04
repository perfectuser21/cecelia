import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';
export const assertDebt10Scratch = pool => verifyPrivatePg(pool);

// 使用真实连接和事务，append-only 回执随事务回滚，绝不删除或禁用其守卫。
export async function openDebt10Transaction() {
  const config = privatePgConfig();
  const { default: pg } = await import('pg');
  const client = new pg.Client(config);
  await client.connect();
  await assertDebt10Scratch(client);
  await client.query('BEGIN');
  return client;
}
export async function closeDebt10Transaction(client) {
  if (!client) return;
  try { await client.query('ROLLBACK'); } finally { await client.end(); }
}
