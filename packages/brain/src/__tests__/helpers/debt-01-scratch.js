import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { readFile } from 'node:fs/promises';

// 显式指定私有端口；拒绝默认服务，绝不加载 dotenv 或生产 db-config。
const port = Number(process.env.DEBT_01_PG_PORT);
if (!Number.isInteger(port) || port < 1024 || port === 5432) {
  throw new Error('DEBT_01_PG_PORT 必须指向自建 scratch PostgreSQL 非默认端口');
}
const schema = `debt_01_${randomUUID().replaceAll('-', '')}`;
export const pool = new pg.Pool({
  host: '127.0.0.1', port, database: 'cecelia_scratch',
  user: process.env.DEBT_01_PG_USER || userInfo().username,
  password: '', max: 2, connectionTimeoutMillis: 2000,
  options: `-c search_path=${schema},public`,
});
let verified = false;
export async function setupScratch() {
  const { rows: [identity] } = await pool.query(
    'SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port',
  );
  if (identity.db !== 'cecelia_scratch' || identity.host !== '127.0.0.1' || identity.port !== port) {
    throw new Error(`scratch identity mismatch: ${JSON.stringify(identity)}`);
  }
  verified = true;
  await pool.query(`CREATE SCHEMA ${schema}`);
  // 合同所需正式迁移子集；不声称覆盖整库迁移兼容性。
  for (const file of [
    '000_base_schema.sql', '001_cecelia_architecture_upgrade.sql',
    '005_schema_version_and_config.sql', '130_task_execution_metrics.sql',
    '133_pr_status.sql', '137_blocked_status.sql', '138_blocked_detail.sql',
  ]) {
    await pool.query(await readFile(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8'));
  }
  // LangGraph 活跃 checkpoint 边界夹具：本组默认无活跃执行。
  await pool.query('CREATE TABLE checkpoints (thread_id text)');
}
export async function closeScratch() {
  try {
    if (verified) await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await pool.end();
  }
}
